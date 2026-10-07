//! Session-scoped float-intent membership store.
//!
//! Rust-owned private store for settled explicit float intent: membership
//! only (normalized live `internalId` strings). No rects, focus, stacking,
//! history, or native writes. The narrow planner-service persistence
//! exception for float intent only.
//!
//! Layout: `<root>/plasma-auto-tiler/float-intent.json` (`XDG_RUNTIME_DIR`
//! in production, a private temp root in tests). Every access is anchored:
//! the absolute root is opened component-by-component from `/`, each
//! ancestor with `O_DIRECTORY|O_NOFOLLOW`, so a symlink anywhere in the
//! chain refuses with `ELOOP` (only the final runtime dir is gated for
//! euid ownership and private mode; system/tmp parent modes are fine).
//! The project dir and final file open relative to that fd with
//! `O_NOFOLLOW`, and ownership (euid), type, and modes (project dir free
//! of group/other bits, file exactly `0600`) are checked with `fstat` on
//! the opened handles, never on paths. Final-file opens add `O_NONBLOCK`
//! so a planted FIFO can never block the gate (regular files are
//! unaffected) and reads degrade immediately. Nothing is ever chmodded:
//! a non-conforming directory or file refuses fail-closed. Writes replace
//! atomically (`O_CREAT|O_EXCL|O_NOFOLLOW` temp plus anchored `renameat`);
//! temp cleanup removes via anchored `unlinkat` only a temp file this exact
//! call created, so a pre-existing occupant is preserved byte-for-byte.
//! Every later access is dir-relative under the walked root fd, so a
//! swapped link can never redirect reads or writes to foreign data.
//!
//! Namespace: serving bus id plus current `org.kde.KWin` owner, derived from
//! the bus by the service layer, never from the caller. Mismatch degrades to
//! empty; the next full write replaces. Missing content reads plain empty;
//! unreadable, corrupt, or oversize content degrades with a fixed reason and
//! zero counts. Write failures retain local intent; no retry machinery.
//!
//! Wire contract on `org.plasmaautotiler.Planner1` (see planner_service):
//! `ReadFloatIntent({"v":1,"correlation_id":..,"live"?[..]})` returns
//! `ok` with `members`/`stored`/`returned`, or `degraded` empty with
//! `namespace-unavailable|unreadable|corrupt|namespace-mismatch`, or
//! `rejected` with `unauthorized|not-kwin-owner`. `live`, when present, is
//! the caller-attested complete inventory: entries must each normalize or
//! the request rejects, and the reply is pruned to the intersection without
//! mutating the file. `WriteFloatIntent({"v":1,"correlation_id":..,
//! "members":[..]})` persists the full snapshot (empty clears) and returns
//! `stored`, or `rejected` (`unauthorized|not-kwin-owner|invalid-request|
//! invalid-members`), or `unavailable` (`namespace-unavailable|
//! store-unavailable`). Oversize bodies fail closed as `Unavailable` errors.
//! Logs carry only the validated correlation (or `-`), op, outcome, counts,
//! and fixed reasons: never ids, owners, bus ids, paths, or payloads.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rustix::fd::OwnedFd;
use rustix::fs::{AtFlags, Mode, OFlags};
use serde::{Deserialize, Serialize};

/// D-Bus member names for the intent routes, mirroring the explicit
/// `#[zbus(name = ...)]` attributes in the service (attributes require
/// literals, so tests pin the two spellings together here).
#[cfg(test)]
pub(crate) const READ_METHOD: &str = "ReadFloatIntent";
#[cfg(test)]
pub(crate) const WRITE_METHOD: &str = "WriteFloatIntent";
/// Request cap: a full 1024-member snapshot with margin.
pub(crate) const INTENT_MAX_REQUEST_BYTES: usize = 256 * 1024;
/// Reply cap: a full 1024-member read with margin.
pub(crate) const INTENT_MAX_REPLY_BYTES: usize = 256 * 1024;
/// Member cap per snapshot, well above any live count.
pub(crate) const MAX_FLOAT_MEMBERS: usize = 1024;
pub(crate) const MAX_CORRELATION_LEN: usize = 128;
pub(crate) const MAX_MEMBER_ID_LEN: usize = 128;
pub(crate) const MAX_NAMESPACE_FIELD_LEN: usize = 256;
pub(crate) const MAX_STORE_FILE_BYTES: u64 = 256 * 1024;
pub(crate) const INTENT_STORE_VERSION: u32 = 1;
pub(crate) const STORE_DIR_NAME: &str = "plasma-auto-tiler";
pub(crate) const STORE_FILE_NAME: &str = "float-intent.json";
const TEMP_FILE_PREFIX: &str = ".float-intent.json.tmp.";
const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFREG: u32 = 0o100000;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Validated namespace: serving bus id plus current KWin owner.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct IntentNamespace {
    bus_id: String,
    kwin_owner: String,
}

impl IntentNamespace {
    /// Both fields non-empty, bounded, and free of path separators,
    /// whitespace, and control bytes; the owner must parse as a unique name.
    pub(crate) fn parse(bus_id: &str, kwin_owner: &str) -> Option<Self> {
        if !valid_namespace_field(bus_id) || !valid_namespace_field(kwin_owner) {
            return None;
        }
        if zbus::names::UniqueName::try_from(kwin_owner).is_err() {
            return None;
        }
        Some(Self {
            bus_id: bus_id.to_owned(),
            kwin_owner: kwin_owner.to_owned(),
        })
    }

    /// Fail-closed sender check: sender equals the live-resolved owner and
    /// parses as a unique name.
    pub(crate) fn authorizes_sender(&self, sender: &str) -> bool {
        sender == self.kwin_owner && zbus::names::UniqueName::try_from(sender).is_ok()
    }
}

fn valid_namespace_field(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_NAMESPACE_FIELD_LEN
        && value.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':' | b'{' | b'}')
        })
}

/// Non-empty bounded `[A-Za-z0-9-_.]` token (core correlation alphabet).
pub(crate) fn valid_correlation(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CORRELATION_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Log-safe echo: the validated token, else `-`.
pub(crate) fn sanitize_correlation(value: &str) -> &str {
    if valid_correlation(value) { value } else { "-" }
}

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_MEMBER_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn is_uuid_text(text: &str) -> bool {
    const LENS: [usize; 5] = [8, 4, 4, 4, 12];
    let mut parts = text.split('-');
    LENS.iter().all(|len| {
        parts.next().is_some_and(|part| {
            part.len() == *len && !part.is_empty() && part.bytes().all(|b| b.is_ascii_hexdigit())
        })
    }) && parts.next().is_none()
}

/// Normalize one live `internalId` like the KWin `normalizeNativeId`
/// utility: opaque passes through, one exact braced-UUID unwraps, else `None`.
pub(crate) fn normalize_member_id(value: &str) -> Option<String> {
    if is_opaque_id(value) {
        return Some(value.to_owned());
    }
    if value.len() == 38 && value.starts_with('{') && value.ends_with('}') {
        let inner = &value[1..37];
        if is_uuid_text(inner) && is_opaque_id(inner) {
            return Some(inner.to_owned());
        }
    }
    None
}

fn normalize_all(members: &[String]) -> Result<Vec<String>, &'static str> {
    if members.len() > MAX_FLOAT_MEMBERS {
        return Err("invalid-members");
    }
    let mut out = Vec::with_capacity(members.len());
    for member in members {
        out.push(normalize_member_id(member).ok_or("invalid-members")?);
    }
    let mut seen = HashSet::with_capacity(out.len());
    if out.iter().map(String::as_str).any(|id| !seen.insert(id)) {
        return Err("invalid-members");
    }
    Ok(out)
}

/// Private runtime store rooted at `root`. Stateless: every call re-opens
/// and re-gates the anchored fds.
#[derive(Clone, Debug)]
pub(crate) struct FloatIntentStore {
    root: PathBuf,
}

impl FloatIntentStore {
    /// Production root from `XDG_RUNTIME_DIR`; `None` when unset or empty.
    pub(crate) fn from_runtime_dir() -> Option<Self> {
        let dir = std::env::var("XDG_RUNTIME_DIR").ok()?;
        if dir.is_empty() {
            return None;
        }
        Some(Self::with_root(PathBuf::from(dir)))
    }

    /// Test seam: store rooted at a private directory.
    pub(crate) fn with_root(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn read_membership(&self, namespace: &IntentNamespace) -> IntentRead {
        self.read_filtered(namespace, None)
    }

    /// Prune to the caller-attested complete live inventory. The file is
    /// never mutated by a read. Malformed live entries were already rejected
    /// at the wire layer; anything left un-normalizable here is skipped.
    pub(crate) fn read_pruned(&self, namespace: &IntentNamespace, live: &[String]) -> IntentRead {
        let allowed: HashSet<String> = live
            .iter()
            .filter_map(|id| normalize_member_id(id))
            .collect();
        self.read_filtered(namespace, Some(&allowed))
    }

    fn read_filtered(
        &self,
        namespace: &IntentNamespace,
        live: Option<&HashSet<String>>,
    ) -> IntentRead {
        let Ok(root) = open_root(&self.root) else {
            return IntentRead::degraded("unreadable");
        };
        let project = match open_project(&root) {
            Ok(Some(fd)) => fd,
            Ok(None) => return IntentRead::empty(),
            Err(()) => return IntentRead::degraded("unreadable"),
        };
        let bytes = match read_final(&project) {
            Ok(None) => return IntentRead::empty(),
            Ok(Some(bytes)) => bytes,
            Err(()) => return IntentRead::degraded("unreadable"),
        };
        let members = match parse_store_bytes(&bytes, namespace) {
            Ok(members) => members,
            Err(reason) => return IntentRead::degraded(reason),
        };
        let stored = members.len();
        let kept: Vec<String> = match live {
            None => members,
            Some(allowed) => members
                .into_iter()
                .filter(|id| allowed.contains(id))
                .collect(),
        };
        IntentRead::ok(kept, stored)
    }

    /// Replace with the full snapshot (empty clears). Members normalize;
    /// duplicates and over-count reject before touching disk. Filesystem
    /// failures retain local intent.
    pub(crate) fn write_membership(
        &self,
        namespace: &IntentNamespace,
        members: &[String],
    ) -> Result<usize, &'static str> {
        let normalized = normalize_all(members)?;
        let body = serde_json::to_string(&StoreFile {
            v: INTENT_STORE_VERSION,
            bus: namespace.bus_id.clone(),
            kwin: namespace.kwin_owner.clone(),
            members: normalized.clone(),
        })
        .map_err(|_| "store-unavailable")?;
        if body.len() as u64 > MAX_STORE_FILE_BYTES {
            return Err("invalid-members");
        }
        let Ok(root) = open_root(&self.root) else {
            return Err("store-unavailable");
        };
        let project = match open_project(&root) {
            Ok(Some(fd)) => fd,
            Ok(None) => create_project(&root).map_err(|()| "store-unavailable")?,
            Err(()) => return Err("store-unavailable"),
        };
        // Refuse to replace a non-conforming file: only a missing file or
        // our own `0600` regular file may be replaced, so a write never
        // follows a link to foreign data.
        if gate_final(&project).is_err() {
            return Err("store-unavailable");
        }
        atomic_replace(&project, body.as_bytes(), &temp_file_name())
            .map_err(|()| "store-unavailable")?;
        Ok(normalized.len())
    }
}

/// Read outcome: returned members, readable on-disk count (`0` when missing
/// or degraded), and the degraded reason if the content was unusable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct IntentRead {
    pub(crate) members: Vec<String>,
    pub(crate) stored: usize,
    pub(crate) degraded: Option<&'static str>,
}

impl IntentRead {
    fn empty() -> Self {
        Self {
            members: Vec::new(),
            stored: 0,
            degraded: None,
        }
    }

    fn ok(members: Vec<String>, stored: usize) -> Self {
        Self {
            members,
            stored,
            degraded: None,
        }
    }

    fn degraded(reason: &'static str) -> Self {
        Self {
            members: Vec::new(),
            stored: 0,
            degraded: Some(reason),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct StoreFile {
    v: u32,
    bus: String,
    kwin: String,
    members: Vec<String>,
}

fn parse_store_bytes(
    bytes: &[u8],
    namespace: &IntentNamespace,
) -> Result<Vec<String>, &'static str> {
    let file: StoreFile = serde_json::from_slice(bytes).map_err(|_| "corrupt")?;
    if file.v != INTENT_STORE_VERSION {
        return Err("corrupt");
    }
    if file.bus != namespace.bus_id || file.kwin != namespace.kwin_owner {
        return Err("namespace-mismatch");
    }
    normalize_all(&file.members).map_err(|_| "corrupt")
}

// ---------------------------------------------------------------------------
// Anchored filesystem: every access is fd-relative under a nofollow root.
// ---------------------------------------------------------------------------

const DIR_FLAGS: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::NOFOLLOW)
    .union(OFlags::CLOEXEC);
const FILE_FLAGS: OFlags = OFlags::RDONLY
    .union(OFlags::NOFOLLOW)
    .union(OFlags::NONBLOCK)
    .union(OFlags::CLOEXEC);

fn not_found(error: &rustix::io::Errno) -> bool {
    std::io::Error::from(*error).kind() == std::io::ErrorKind::NotFound
}

fn euid() -> u32 {
    rustix::process::geteuid().as_raw()
}

/// Open the absolute root component-by-component from `/`, each ancestor
/// with `O_DIRECTORY|O_NOFOLLOW`: a symlink anywhere in the chain refuses
/// with `ELOOP`, and `..`/`.` components reject outright. Only the final
/// runtime dir is gated (euid-owned, no group/other bits); parent modes are
/// whatever the system or tmp hierarchy uses. Never chmodded.
fn open_root(root: &Path) -> Result<OwnedFd, ()> {
    let mut components = root.components();
    if components.next() != Some(Component::RootDir) {
        return Err(());
    }
    let mut parent =
        rustix::fs::openat(rustix::fs::CWD, "/", DIR_FLAGS, Mode::empty()).map_err(|_| ())?;
    for component in components {
        let Component::Normal(name) = component else {
            return Err(());
        };
        parent = rustix::fs::openat(&parent, name, DIR_FLAGS, Mode::empty()).map_err(|_| ())?;
    }
    gate_private_dir(&parent)?;
    Ok(parent)
}

/// Dir gate on an opened handle: real dir, euid-owned, no group/other bits.
fn gate_private_dir(fd: &OwnedFd) -> Result<(), ()> {
    let stat = rustix::fs::fstat(fd).map_err(|_| ())?;
    if stat.st_mode & S_IFMT != S_IFDIR || stat.st_uid != euid() || stat.st_mode & 0o077 != 0 {
        return Err(());
    }
    Ok(())
}

/// Open the project dir relative to the root fd. `Ok(None)` is missing.
fn open_project(root: &OwnedFd) -> Result<Option<OwnedFd>, ()> {
    match rustix::fs::openat(root, STORE_DIR_NAME, DIR_FLAGS, Mode::empty()) {
        Ok(fd) => {
            gate_private_dir(&fd)?;
            Ok(Some(fd))
        }
        Err(error) if not_found(&error) => Ok(None),
        Err(_) => Err(()),
    }
}

/// Create the project dir (`mkdirat` never follows a same-name symlink;
/// `EEXIST` races re-open under the same nofollow gates) and verify the
/// opened handle. Never chmods.
fn create_project(root: &OwnedFd) -> Result<OwnedFd, ()> {
    match rustix::fs::mkdirat(root, STORE_DIR_NAME, Mode::from_bits_truncate(0o700)) {
        Ok(()) => {}
        Err(error) if not_found(&error) => return Err(()),
        Err(_) => {}
    }
    let fd = rustix::fs::openat(root, STORE_DIR_NAME, DIR_FLAGS, Mode::empty()).map_err(|_| ())?;
    gate_private_dir(&fd)?;
    Ok(fd)
}

/// Gate the final file on its opened nofollow handle: missing is `Ok(false)`,
/// our `0600` euid regular file is `Ok(true)`, anything else refuses.
fn gate_final(dir: &OwnedFd) -> Result<bool, ()> {
    let fd = match rustix::fs::openat(dir, STORE_FILE_NAME, FILE_FLAGS, Mode::empty()) {
        Ok(fd) => fd,
        Err(error) if not_found(&error) => return Ok(false),
        Err(_) => return Err(()),
    };
    let stat = rustix::fs::fstat(&fd).map_err(|_| ())?;
    if stat.st_mode & S_IFMT != S_IFREG || stat.st_uid != euid() || stat.st_mode & 0o777 != 0o600 {
        return Err(());
    }
    Ok(true)
}

/// Bounded read through the gated handle: `take(cap + 1)` so a growing file
/// can never exceed the bound.
fn read_final(dir: &OwnedFd) -> Result<Option<Vec<u8>>, ()> {
    if !gate_final(dir)? {
        return Ok(None);
    }
    let fd = rustix::fs::openat(dir, STORE_FILE_NAME, FILE_FLAGS, Mode::empty()).map_err(|_| ())?;
    if gate_final_fd(&fd).is_err() {
        return Err(());
    }
    let mut bytes = Vec::new();
    std::fs::File::from(fd)
        .take(MAX_STORE_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > MAX_STORE_FILE_BYTES {
        return Err(());
    }
    Ok(Some(bytes))
}

fn gate_final_fd(fd: &OwnedFd) -> Result<(), ()> {
    let stat = rustix::fs::fstat(fd).map_err(|_| ())?;
    if stat.st_mode & S_IFMT != S_IFREG || stat.st_uid != euid() || stat.st_mode & 0o777 != 0o600 {
        return Err(());
    }
    Ok(())
}

fn temp_file_name() -> String {
    let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{TEMP_FILE_PREFIX}{}{id}", std::process::id())
}

/// Anchored atomic replace. Only a temp file this exact call created
/// (`O_CREAT|O_EXCL|O_NOFOLLOW`) is ever unlinked, via anchored `unlinkat`;
/// a pre-existing occupant fails creation and is preserved byte-for-byte.
/// The post-rename handle is re-gated before reporting success.
pub(crate) fn atomic_replace(dir: &OwnedFd, body: &[u8], temp_name: &str) -> Result<(), ()> {
    let fd = match rustix::fs::openat(
        dir,
        temp_name,
        OFlags::WRONLY
            .union(OFlags::CREATE)
            .union(OFlags::EXCL)
            .union(OFlags::NOFOLLOW)
            .union(OFlags::CLOEXEC),
        Mode::from_bits_truncate(0o600),
    ) {
        Ok(fd) => fd,
        Err(_) => return Err(()),
    };
    let wrote = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::from(fd);
        file.write_all(body)?;
        file.sync_all()?;
        Ok(())
    })();
    if wrote.is_err() {
        let _ = rustix::fs::unlinkat(dir, temp_name, AtFlags::empty());
        return Err(());
    }
    if rustix::fs::renameat(dir, temp_name, dir, STORE_FILE_NAME).is_err() {
        let _ = rustix::fs::unlinkat(dir, temp_name, AtFlags::empty());
        return Err(());
    }
    if gate_final(dir) != Ok(true) {
        return Err(());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Wire JSON: requests, replies, summaries.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct WriteWire {
    v: u32,
    correlation_id: String,
    members: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct ReadWire {
    v: u32,
    correlation_id: String,
    live: Option<Vec<serde_json::Value>>,
}

#[derive(Debug)]
pub(crate) struct WriteRequest {
    pub(crate) correlation: String,
    pub(crate) members: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct ReadRequest {
    pub(crate) correlation: String,
    pub(crate) live: Option<Vec<String>>,
}

/// Owned parse failure: validated correlation (or `-`) plus a fixed reason.
#[derive(Debug)]
pub(crate) struct RequestParseError {
    pub(crate) correlation: String,
    pub(crate) reason: &'static str,
}

impl RequestParseError {
    fn new(correlation: &str, reason: &'static str) -> Self {
        Self {
            correlation: correlation.to_owned(),
            reason,
        }
    }
}

fn string_entries(
    entries: &[serde_json::Value],
    correlation: &str,
    cap: usize,
    reason: &'static str,
) -> Result<Vec<String>, RequestParseError> {
    if entries.len() > cap {
        return Err(RequestParseError::new(correlation, reason));
    }
    entries
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .map(str::to_owned)
                .ok_or(RequestParseError::new(correlation, "invalid-request"))
        })
        .collect()
}

fn valid_wire(v: u32, correlation_id: &str) -> Result<String, RequestParseError> {
    if v != 1 || !valid_correlation(correlation_id) {
        return Err(RequestParseError::new("-", "invalid-request"));
    }
    Ok(correlation_id.to_owned())
}

/// Structural failures are `invalid-request`; over-count is `invalid-members`
/// (id content is validated by the store write, also `invalid-members`).
pub(crate) fn parse_write_request(body: &str) -> Result<WriteRequest, RequestParseError> {
    let wire: WriteWire =
        serde_json::from_str(body).map_err(|_| RequestParseError::new("-", "invalid-request"))?;
    let correlation = valid_wire(wire.v, &wire.correlation_id)?;
    let members = string_entries(
        &wire.members,
        &correlation,
        MAX_FLOAT_MEMBERS,
        "invalid-members",
    )?;
    Ok(WriteRequest {
        correlation,
        members,
    })
}

/// `live` must be an array of normalizable ids when present: a malformed
/// entry rejects the request rather than silently dropping records.
pub(crate) fn parse_read_request(body: &str) -> Result<ReadRequest, RequestParseError> {
    let wire: ReadWire =
        serde_json::from_str(body).map_err(|_| RequestParseError::new("-", "invalid-request"))?;
    let correlation = valid_wire(wire.v, &wire.correlation_id)?;
    let live = wire
        .live
        .map(|entries| {
            let ids = string_entries(&entries, &correlation, MAX_FLOAT_MEMBERS, "invalid-request")?;
            for id in &ids {
                if normalize_member_id(id).is_none() {
                    return Err(RequestParseError::new(&correlation, "invalid-request"));
                }
            }
            Ok(ids)
        })
        .transpose()?;
    Ok(ReadRequest { correlation, live })
}

/// Fixed-shape in-band rejection. Inputs must be validated correlation (or
/// `-`) and a fixed reason.
pub(crate) fn intent_rejection(correlation: &str, reason: &str) -> String {
    serde_json::json!({
        "v": 1,
        "correlation_id": sanitize_correlation(correlation),
        "outcome": "rejected",
        "members": [],
        "reason": reason,
    })
    .to_string()
}

pub(crate) fn write_stored_reply(correlation: &str, stored: usize) -> String {
    serde_json::json!({
        "v": 1,
        "correlation_id": sanitize_correlation(correlation),
        "outcome": "stored",
        "stored": stored,
    })
    .to_string()
}

/// `outcome` is `rejected` or `unavailable`; the reason must be a fixed label.
pub(crate) fn write_failed_reply(correlation: &str, outcome: &str, reason: &str) -> String {
    serde_json::json!({
        "v": 1,
        "correlation_id": sanitize_correlation(correlation),
        "outcome": outcome,
        "reason": reason,
    })
    .to_string()
}

pub(crate) fn read_ok_reply(correlation: &str, members: &[String], stored: usize) -> String {
    serde_json::json!({
        "v": 1,
        "correlation_id": sanitize_correlation(correlation),
        "outcome": "ok",
        "members": members,
        "stored": stored,
        "returned": members.len(),
    })
    .to_string()
}

/// Degraded reply: empty membership with a fixed reason and zero counts.
pub(crate) fn read_degraded_reply(correlation: &str, reason: &str) -> String {
    serde_json::json!({
        "v": 1,
        "correlation_id": sanitize_correlation(correlation),
        "outcome": "degraded",
        "members": [],
        "stored": 0,
        "returned": 0,
        "reason": reason,
    })
    .to_string()
}

/// Bounded terminal summary over counts and fixed labels only: no ids,
/// owners, bus ids, paths, payloads, or error strings.
pub(crate) fn intent_egress_summary(
    op: &str,
    correlation: &str,
    outcome: &str,
    stored: Option<usize>,
    returned: Option<usize>,
    reason: Option<&str>,
) -> String {
    format!(
        "plasma-auto-tiler:intent-summary direction=egress op={op} correlation={} outcome={outcome} stored={} returned={} reason={}",
        sanitize_correlation(correlation),
        stored.map_or_else(|| "-".to_owned(), |count| count.to_string()),
        returned.map_or_else(|| "-".to_owned(), |count| count.to_string()),
        reason.unwrap_or("-"),
    )
}

/// Best-effort diagnostic writer: the write result is discarded so logging
/// never changes intent behavior.
pub(crate) fn emit_intent_diag(line: &str) {
    let _ = writeln!(std::io::stderr(), "{line}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::AtomicU64;

    static TEST_ROOT_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn fresh_root(name: &str) -> PathBuf {
        let id = TEST_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("pat-intent-{name}-{}-{id}", std::process::id()));
        let mut builder = std::fs::DirBuilder::new();
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&root).expect("temp root");
        root
    }

    fn drop_root(root: &Path) {
        let _ = std::fs::remove_dir_all(root);
    }

    fn namespace(bus: &str, owner: &str) -> IntentNamespace {
        IntentNamespace::parse(bus, owner).expect("valid namespace")
    }

    fn project_fd_for(root: &Path) -> OwnedFd {
        let root_fd = open_root(root).expect("root opens");
        match open_project(&root_fd).expect("project opens or missing") {
            Some(fd) => fd,
            None => create_project(&root_fd).expect("project created"),
        }
    }

    /// Raw file plant for corruption fixtures: test setup only, never the
    /// production path (which only writes through `atomic_replace`).
    fn plant_file(root: &Path, body: &[u8]) {
        let project = project_fd_for(root);
        let fd = rustix::fs::openat(
            &project,
            STORE_FILE_NAME,
            OFlags::WRONLY
                .union(OFlags::CREATE)
                .union(OFlags::TRUNC)
                .union(OFlags::CLOEXEC),
            Mode::from_bits_truncate(0o600),
        )
        .expect("plant opens");
        let mut file = std::fs::File::from(fd);
        file.write_all(body).expect("plant writes");
    }

    #[test]
    fn correlation_gate_matches_core_alphabet() {
        assert!(valid_correlation("corr-1a_Z.9"));
        assert!(!valid_correlation(""));
        assert!(!valid_correlation("bad corr"));
        assert!(!valid_correlation("evil\nline"));
        assert!(!valid_correlation(&"x".repeat(MAX_CORRELATION_LEN + 1)));
        assert_eq!(sanitize_correlation("ok-1"), "ok-1");
        assert_eq!(sanitize_correlation("evil id"), "-");
    }

    #[test]
    fn member_normalization_matches_kwin_utility() {
        assert_eq!(
            normalize_member_id("abc-XYZ_0.9"),
            Some("abc-XYZ_0.9".to_owned())
        );
        assert_eq!(
            normalize_member_id("{12345678-1234-1234-1234-1234567890ab}"),
            Some("12345678-1234-1234-1234-1234567890ab".to_owned())
        );
        assert_eq!(normalize_member_id(""), None);
        assert_eq!(normalize_member_id("has space"), None);
        assert_eq!(normalize_member_id("has/slash"), None);
        assert_eq!(normalize_member_id("{not-a-uuid}"), None);
        assert_eq!(
            normalize_member_id(&"x".repeat(MAX_MEMBER_ID_LEN + 1)),
            None
        );
    }

    #[test]
    fn namespace_parse_is_bounded_and_authorizes_sender() {
        assert!(IntentNamespace::parse("bus-id-1", ":1.7").is_some());
        assert!(IntentNamespace::parse("", ":1.7").is_none());
        assert!(IntentNamespace::parse("bus id", ":1.7").is_none());
        assert!(IntentNamespace::parse("bus/id", ":1.7").is_none());
        assert!(IntentNamespace::parse("bus-id-1", "not-a-unique-name").is_none());
        let ns = namespace("bus-id-1", ":1.7");
        assert!(ns.authorizes_sender(":1.7"));
        assert!(!ns.authorizes_sender(":1.8"));
        assert!(!ns.authorizes_sender("not-unique"));
    }

    #[test]
    fn roundtrip_survives_service_restart() {
        let root = fresh_root("restart");
        let ns = namespace("bus-restart", ":1.7");
        let members = vec!["win-a".to_owned(), "win-b".to_owned()];
        assert_eq!(
            FloatIntentStore::with_root(root.clone()).write_membership(&ns, &members),
            Ok(2)
        );
        let read = FloatIntentStore::with_root(root.clone()).read_membership(&ns);
        assert_eq!(read.degraded, None);
        assert_eq!(read.stored, 2);
        assert_eq!(read.members, members);
        drop_root(&root);
    }

    #[test]
    fn missing_store_reads_plain_empty() {
        let root = fresh_root("missing");
        let read =
            FloatIntentStore::with_root(root.clone()).read_membership(&namespace("bus-m", ":1.7"));
        assert_eq!(read.degraded, None);
        assert_eq!(read.stored, 0);
        assert!(read.members.is_empty());
        drop_root(&root);
    }

    #[test]
    fn namespace_mismatch_degrades_empty_and_write_replaces() {
        let root = fresh_root("ns");
        let store = FloatIntentStore::with_root(root.clone());
        let first = namespace("bus-one", ":1.7");
        let new_bus = namespace("bus-two", ":1.7");
        let new_owner = namespace("bus-one", ":1.9");
        store
            .write_membership(&first, &["win-a".to_owned()])
            .expect("write");
        for other in [&new_bus, &new_owner] {
            let read = store.read_membership(other);
            assert_eq!(read.degraded, Some("namespace-mismatch"));
            assert!(read.members.is_empty());
        }
        assert_eq!(
            store.write_membership(&new_bus, &["win-b".to_owned()]),
            Ok(1)
        );
        assert_eq!(
            store.read_membership(&new_bus).members,
            vec!["win-b".to_owned()]
        );
        drop_root(&root);
    }

    #[test]
    fn corrupt_and_oversize_and_bad_entries_degrade() {
        let root = fresh_root("corrupt");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-corrupt", ":1.7");
        let bad = [
            "not json{{{",
            r#"{"v":2,"bus":"bus-corrupt","kwin":":1.7","members":[]}"#,
            r#"{"v":1,"bus":"bus-corrupt","kwin":":1.7","members":{}}"#,
            r#"{"v":1,"bus":"bus-corrupt","kwin":":1.7","members":[42]}"#,
            r#"{"v":1,"bus":"bus-corrupt","kwin":":1.7","members":[""]}"#,
            r#"{"v":1,"bus":"bus-corrupt","kwin":":1.7","members":["has space"]}"#,
            r#"{"v":1,"bus":"bus-corrupt","kwin":":1.7","members":["a","a"]}"#,
        ];
        for body in bad {
            plant_file(&root, body.as_bytes());
            assert_eq!(
                store.read_membership(&ns).degraded,
                Some("corrupt"),
                "{body}"
            );
        }
        plant_file(&root, &vec![b'x'; MAX_STORE_FILE_BYTES as usize + 1]);
        assert_eq!(store.read_membership(&ns).degraded, Some("unreadable"));
        assert_eq!(store.write_membership(&ns, &["win-a".to_owned()]), Ok(1));
        assert_eq!(store.read_membership(&ns).members, vec!["win-a".to_owned()]);
        drop_root(&root);
    }

    #[test]
    fn unfloat_empty_snapshot_clears() {
        let root = fresh_root("unfloat");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-unfloat", ":1.7");
        store
            .write_membership(&ns, &["win-a".to_owned()])
            .expect("float");
        assert_eq!(store.write_membership(&ns, &[]), Ok(0));
        let read = store.read_membership(&ns);
        assert_eq!(read.degraded, None);
        assert_eq!(read.stored, 0);
        assert!(read.members.is_empty());
        drop_root(&root);
    }

    #[test]
    fn live_prune_returns_intersection_without_mutating_file() {
        let root = fresh_root("prune");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-prune", ":1.7");
        store
            .write_membership(&ns, &["win-a".to_owned(), "win-b".to_owned()])
            .expect("write");
        let pruned = store.read_pruned(&ns, &["win-a".to_owned()]);
        assert_eq!(pruned.degraded, None);
        assert_eq!(pruned.stored, 2);
        assert_eq!(pruned.members, vec!["win-a".to_owned()]);
        assert_eq!(store.read_membership(&ns).members.len(), 2);
        drop_root(&root);
    }

    #[test]
    fn write_validates_members_before_touching_disk() {
        let root = fresh_root("validate");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-validate", ":1.7");
        assert_eq!(
            store.write_membership(&ns, &["bad id".to_owned()]),
            Err("invalid-members")
        );
        assert_eq!(
            store.write_membership(&ns, &["a".to_owned(), "a".to_owned()]),
            Err("invalid-members")
        );
        assert_eq!(
            store.write_membership(&ns, &vec!["a".to_owned(); MAX_FLOAT_MEMBERS + 1]),
            Err("invalid-members")
        );
        let read = store.read_membership(&ns);
        assert_eq!(read.degraded, None);
        assert!(read.members.is_empty());
        drop_root(&root);
    }

    #[test]
    fn created_modes_are_private_and_wrong_modes_refuse() {
        let root = fresh_root("perms");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-perms", ":1.7");
        store
            .write_membership(&ns, &["win-a".to_owned()])
            .expect("write");
        let mode_of = |fd: &OwnedFd| rustix::fs::fstat(fd).expect("fstat").st_mode & 0o777;
        let root_fd = open_root(&root).expect("root opens");
        assert_eq!(mode_of(&root_fd), 0o700);
        // Nothing is ever chmodded: loosening the root refuses and the mode
        // bits are untouched.
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).expect("loosen");
        assert_eq!(store.read_membership(&ns).degraded, Some("unreadable"));
        assert_eq!(
            store.write_membership(&ns, &["win-a".to_owned()]),
            Err("store-unavailable")
        );
        assert_eq!(
            std::fs::symlink_metadata(&root)
                .expect("meta")
                .permissions()
                .mode()
                & 0o777,
            0o755,
            "root must never be chmodded"
        );
        drop_root(&root);
    }

    #[test]
    fn wrong_mode_project_dir_refuses_without_chmod() {
        let root = fresh_root("dirperm");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-dirperm", ":1.7");
        store
            .write_membership(&ns, &["win-a".to_owned()])
            .expect("write");
        let project = root.join(STORE_DIR_NAME);
        std::fs::set_permissions(&project, std::fs::Permissions::from_mode(0o755)).expect("loosen");
        assert_eq!(store.read_membership(&ns).degraded, Some("unreadable"));
        assert_eq!(
            store.write_membership(&ns, &["win-b".to_owned()]),
            Err("store-unavailable")
        );
        assert_eq!(
            std::fs::symlink_metadata(&project)
                .expect("meta")
                .permissions()
                .mode()
                & 0o777,
            0o755,
            "existing dir must never be chmodded"
        );
        drop_root(&root);
    }

    #[test]
    fn symlinks_are_refused_and_foreign_data_survives() {
        let root = fresh_root("symlink");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-symlink", ":1.7");
        let foreign = root.join("foreign.json");
        let sentinel = br#"{"v":1,"bus":"bus-symlink","kwin":":1.7","members":["foreign-win"]}"#;
        std::fs::write(&foreign, sentinel).expect("foreign");
        // Ensure the project dir exists for the path-based link plant below;
        // production access itself stays anchored.
        let _ = project_fd_for(&root);
        std::os::unix::fs::symlink(
            &foreign,
            root.join(format!("{STORE_DIR_NAME}/{STORE_FILE_NAME}")),
        )
        .expect("file link");
        // The anchored open refuses the linked final component: the foreign
        // bytes are never read and a write never follows the link.
        let read = store.read_membership(&ns);
        assert_eq!(read.degraded, Some("unreadable"));
        assert!(read.members.is_empty());
        assert_eq!(
            store.write_membership(&ns, &["win-a".to_owned()]),
            Err("store-unavailable")
        );
        assert_eq!(std::fs::read(&foreign).expect("foreign"), sentinel);
        // A linked project dir refuses as well.
        let root2 = fresh_root("symlink-dir");
        let elsewhere = root2.join("elsewhere");
        std::fs::create_dir(&elsewhere).expect("elsewhere");
        std::os::unix::fs::symlink(&elsewhere, root2.join(STORE_DIR_NAME)).expect("dir link");
        assert_eq!(
            FloatIntentStore::with_root(root2.clone())
                .read_membership(&namespace("bus-symlink", ":1.7"))
                .degraded,
            Some("unreadable")
        );
        // A linked root refuses as well.
        let root3 = fresh_root("symlink-root");
        let link = root3.join("link-root");
        std::os::unix::fs::symlink(&root, &link).expect("root link");
        assert_eq!(
            FloatIntentStore::with_root(link)
                .read_membership(&ns)
                .degraded,
            Some("unreadable")
        );
        drop_root(&root);
        drop_root(&root2);
        drop_root(&root3);
    }

    #[test]
    fn nested_ancestor_symlink_refuses_without_foreign_changes() {
        let outer = fresh_root("ancestors");
        // Real chain with a sentinel proving it is never written through.
        let real_sub = outer.join("real").join("sub");
        std::fs::create_dir_all(&real_sub).expect("real chain");
        std::fs::set_permissions(&real_sub, std::fs::Permissions::from_mode(0o700))
            .expect("strict sub");
        let sentinel = outer.join("real").join("sentinel.txt");
        std::fs::write(&sentinel, b"sentinel-bytes").expect("sentinel");
        // Nested link in the middle of the addressed chain.
        let wrap = outer.join("wrap");
        std::fs::create_dir(&wrap).expect("wrap");
        std::os::unix::fs::symlink(outer.join("real"), wrap.join("link")).expect("nested link");
        let via_link = wrap.join("link").join("sub");
        let store = FloatIntentStore::with_root(via_link);
        let ns = namespace("bus-ancestors", ":1.7");
        // The component walk refuses the linked ancestor with ELOOP before
        // any gate or read, so nothing under the real chain is created or
        // modified.
        let read = store.read_membership(&ns);
        assert_eq!(read.degraded, Some("unreadable"));
        assert!(read.members.is_empty());
        assert_eq!(
            store.write_membership(&ns, &["win-a".to_owned()]),
            Err("store-unavailable")
        );
        assert!(
            wrap.join("link")
                .symlink_metadata()
                .expect("meta")
                .file_type()
                .is_symlink(),
            "nested link itself is untouched"
        );
        assert_eq!(
            std::fs::read(&sentinel).expect("sentinel"),
            b"sentinel-bytes"
        );
        assert!(
            !real_sub.join(STORE_DIR_NAME).exists(),
            "no project dir is created through the refused chain"
        );
        drop_root(&outer);
    }

    #[test]
    fn relative_and_dotdot_roots_refuse_without_touching_disk() {
        let ns = namespace("bus-relroot", ":1.7");
        let relative = FloatIntentStore::with_root(PathBuf::from("relative-intent-root"));
        assert_eq!(relative.read_membership(&ns).degraded, Some("unreadable"));
        assert_eq!(
            relative.write_membership(&ns, &["win-a".to_owned()]),
            Err("store-unavailable")
        );
        assert!(!Path::new("relative-intent-root").exists());
        // An absolute path that only resolves through `..` still refuses:
        // the walk rejects the ParentDir component before resolution.
        let sibling = fresh_root("dotdot-sib");
        let target = fresh_root("dotdot-target");
        let via_dotdot = sibling.join("..").join(target.file_name().expect("name"));
        let store = FloatIntentStore::with_root(via_dotdot);
        assert_eq!(store.read_membership(&ns).degraded, Some("unreadable"));
        assert_eq!(
            store.write_membership(&ns, &["win-a".to_owned()]),
            Err("store-unavailable")
        );
        assert!(!target.join(STORE_DIR_NAME).exists());
        drop_root(&sibling);
        drop_root(&target);
    }

    #[test]
    fn planted_fifo_degrades_and_fails_without_blocking() {
        let root = fresh_root("fifo");
        let store = FloatIntentStore::with_root(root.clone());
        let ns = namespace("bus-fifo", ":1.7");
        let project = project_fd_for(&root);
        rustix::fs::mkfifoat(&project, STORE_FILE_NAME, Mode::from_bits_truncate(0o600))
            .expect("fifo plant");
        drop(project);
        // O_NONBLOCK on the final-file opens means the gate open returns
        // immediately instead of blocking on the FIFO; fstat then rejects
        // the non-regular type, so the read degrades and the write fails.
        let read = store.read_membership(&ns);
        assert_eq!(read.degraded, Some("unreadable"));
        assert!(read.members.is_empty());
        assert_eq!(
            store.write_membership(&ns, &["win-a".to_owned()]),
            Err("store-unavailable")
        );
        drop_root(&root);
    }

    #[test]
    fn occupied_temp_is_preserved_byte_for_byte() {
        let root = fresh_root("tempcollide");
        let project = project_fd_for(&root);
        // A pre-existing file at the temp name fails exclusive creation and
        // is preserved byte-for-byte; nothing is unlinked.
        let occupant = b"occupant-bytes";
        let temp = "fixed-temp-name";
        let fd = rustix::fs::openat(
            &project,
            temp,
            OFlags::WRONLY
                .union(OFlags::CREATE)
                .union(OFlags::EXCL)
                .union(OFlags::CLOEXEC),
            Mode::from_bits_truncate(0o600),
        )
        .expect("plant occupant");
        let mut file = std::fs::File::from(fd);
        file.write_all(occupant).expect("plant bytes");
        drop(file);
        assert_eq!(atomic_replace(&project, b"{}", temp), Err(()));
        let fd = rustix::fs::openat(&project, temp, FILE_FLAGS, Mode::empty()).expect("reopen");
        let mut kept = Vec::new();
        std::fs::File::from(fd)
            .read_to_end(&mut kept)
            .expect("reread");
        assert_eq!(kept, occupant);
        // A pre-existing symlink at the temp name is likewise preserved (no
        // unlink, no follow).
        let link_temp = "fixed-temp-link";
        let target = root.join("link-target.json");
        std::fs::write(&target, b"target-bytes").expect("target");
        std::os::unix::fs::symlink(&target, root.join(format!("{STORE_DIR_NAME}/{link_temp}")))
            .expect("temp link");
        assert_eq!(atomic_replace(&project, b"{}", link_temp), Err(()));
        assert!(
            std::fs::symlink_metadata(root.join(format!("{STORE_DIR_NAME}/{link_temp}")))
                .expect("meta")
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read(&target).expect("target"), b"target-bytes");
        drop(project);
        drop_root(&root);
    }

    #[test]
    fn successful_writes_leave_no_temp_files() {
        let root = fresh_root("notemp");
        let store = FloatIntentStore::with_root(root.clone());
        store
            .write_membership(&namespace("bus-notemp", ":1.7"), &["win-a".to_owned()])
            .expect("write");
        let leftovers: Vec<_> = std::fs::read_dir(root.join(STORE_DIR_NAME))
            .expect("list dir")
            .filter_map(|entry| entry.ok().map(|entry| entry.file_name()))
            .filter(|name| name.to_string_lossy().starts_with(TEMP_FILE_PREFIX))
            .collect();
        assert!(leftovers.is_empty(), "no temp files remain: {leftovers:?}");
        drop_root(&root);
    }

    #[test]
    fn summaries_carry_counts_never_ids() {
        let line = intent_egress_summary("read", "evil-id\n:1.999", "ok", Some(2), Some(1), None);
        assert!(line.contains("correlation=-"), "{line}");
        assert!(line.contains("stored=2"), "{line}");
        assert!(line.contains("returned=1"), "{line}");
        assert!(!line.contains("evil"), "{line}");
        assert!(!line.contains(":1.999"), "{line}");
        let line = intent_egress_summary(
            "write",
            "corr-1",
            "degraded",
            Some(0),
            Some(0),
            Some("corrupt"),
        );
        assert!(line.contains("correlation=corr-1"), "{line}");
        assert!(line.contains("reason=corrupt"), "{line}");
        assert!(!line.contains('\n'), "{line}");
    }

    #[test]
    fn wire_replies_are_bounded_fixed_shapes() {
        let ok = write_stored_reply("corr-1", 2);
        let parsed: serde_json::Value = serde_json::from_str(&ok).expect("valid JSON");
        assert_eq!(parsed["outcome"], "stored");
        assert_eq!(parsed["stored"], 2);
        assert!(ok.len() <= INTENT_MAX_REPLY_BYTES);
        let rejected = intent_rejection("evil corr", "unauthorized");
        assert!(rejected.contains("\"correlation_id\":\"-\""), "{rejected}");
        assert!(!rejected.contains("evil"), "{rejected}");
        let degraded = read_degraded_reply("corr-1", "corrupt");
        let parsed: serde_json::Value = serde_json::from_str(&degraded).expect("valid JSON");
        assert_eq!(parsed["outcome"], "degraded");
        assert_eq!(parsed["members"].as_array().expect("array").len(), 0);
        let ok = read_ok_reply("corr-1", &["win-a".to_owned()], 1);
        let parsed: serde_json::Value = serde_json::from_str(&ok).expect("valid JSON");
        assert_eq!(parsed["stored"], 1);
        assert_eq!(parsed["returned"], 1);
    }

    #[test]
    fn write_request_parsing_separates_structural_from_semantic() {
        let good = parse_write_request(r#"{"v":1,"correlation_id":"corr-1","members":["win-a"]}"#)
            .expect("valid");
        assert_eq!(good.correlation, "corr-1");
        assert_eq!(good.members, vec!["win-a".to_owned()]);
        for body in [
            "not json",
            r#"{"v":1,"members":[]}"#,
            r#"{"v":1,"correlation_id":"bad corr","members":[]}"#,
            r#"{"v":2,"correlation_id":"corr-1","members":[]}"#,
            r#"{"v":1,"correlation_id":"corr-1","members":{}}"#,
            r#"{"v":1,"correlation_id":"corr-1","members":[42]}"#,
        ] {
            let error = parse_write_request(body).expect_err("must reject");
            assert_eq!(error.reason, "invalid-request", "{body}");
            assert!(!error.correlation.contains("bad"), "{body}");
        }
        let clear = parse_write_request(r#"{"v":1,"correlation_id":"corr-1","members":[]}"#)
            .expect("empty clears");
        assert!(clear.members.is_empty());
    }

    #[test]
    fn read_request_parsing_rejects_malformed_live() {
        let plain = parse_read_request(r#"{"v":1,"correlation_id":"corr-1"}"#).expect("valid");
        assert_eq!(plain.correlation, "corr-1");
        assert!(plain.live.is_none());
        let pruned = parse_read_request(r#"{"v":1,"correlation_id":"corr-1","live":["win-a"]}"#)
            .expect("valid");
        assert_eq!(pruned.live, Some(vec!["win-a".to_owned()]));
        // Malformed live entries reject instead of silently dropping records.
        for body in [
            r#"{"v":1,"correlation_id":"corr-1","live":{}}"#,
            r#"{"v":1,"correlation_id":"corr-1","live":[42]}"#,
            r#"{"v":1,"correlation_id":"corr-1","live":["bad id"]}"#,
            r#"{"v":1,"correlation_id":"corr-1","live":[""]}"#,
            r#"{"v":1,"correlation_id":"bad corr"}"#,
        ] {
            assert!(parse_read_request(body).is_err(), "{body}");
        }
    }
}
