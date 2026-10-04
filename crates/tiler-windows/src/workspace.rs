//! Per-output-local managed workspaces plus digit classification.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use tiler_core::workspace as policy;

pub const VK_LWIN: u32 = 91;
pub const VK_RWIN: u32 = 92;
pub const VK_SHIFT: u32 = 16;
pub const VK_LSHIFT: u32 = 160;
pub const VK_RSHIFT: u32 = 161;
pub const VK_CTRL: u32 = 17;
pub const VK_LCTRL: u32 = 162;
pub const VK_RCTRL: u32 = 163;
pub const VK_ALT: u32 = 18;
pub const VK_LALT: u32 = 164;
pub const VK_RALT: u32 = 165;
pub const VK_0: u32 = 0x30;
pub const VK_9: u32 = 0x39;

/// Digit op shared with the unified hook classifier: unshifted selects,
/// Shift sends. Single authority lives in `snapkey::WorkspaceOp`; this alias
/// keeps the portable session-policy vocabulary stable.
pub use crate::snapkey::WorkspaceOp as DigitOp;

/// Decode one Win+digit chord. Shift selects send; Ctrl/Alt or missing Win
/// refuse. Symbol aliases share the digit VK on the same physical key.
#[must_use]
pub const fn decode_digit(
    vk: u32,
    shift: bool,
    ctrl: bool,
    alt: bool,
    win_held: bool,
) -> Option<(DigitOp, u8)> {
    if !win_held || ctrl || alt || vk < VK_0 || vk > VK_9 {
        return None;
    }
    let index = (vk - VK_0) as u8;
    let op = if shift {
        DigitOp::Send
    } else {
        DigitOp::Select
    };
    Some((op, index))
}

#[must_use]
pub const fn is_digit_vk(vk: u32) -> bool {
    vk >= VK_0 && vk <= VK_9
}

/// Stable session member identity: HWND plus process-lifetime evidence.
/// Deliberately carries no product nonce: the nonce exists only while hidden
/// and is removed on reveal, so visible membership keyed by nonce would flap.
/// Hidden claims bind the ephemeral nonce separately in the owner table and
/// the ledger; same-process HWND reuse fences on `(hwnd, creation)` plus the
/// live nonce check before any effect.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WindowKey {
    pub hwnd: u64,
    pub pid: u32,
    pub creation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberLoc {
    pub output: String,
    pub workspace: String,
    pub hidden: bool,
}

#[derive(Debug, Clone)]
pub struct WorkspaceEntry {
    pub id: String,
    pub token: String,
    pub members: BTreeSet<WindowKey>,
    pub last_focus: Option<WindowKey>,
}

#[derive(Debug, Clone)]
pub struct OutputState {
    pub key: String,
    pub token: String,
    pub order: Vec<WorkspaceEntry>,
    pub active: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplacedRecord {
    pub workspace_ids: Vec<String>,
    pub dest_key: String,
}

#[derive(Debug)]
pub struct ManagedWorkspaces {
    outputs: BTreeMap<String, OutputState>,
    displaced: BTreeMap<String, DisplacedRecord>,
    membership: BTreeMap<WindowKey, MemberLoc>,
    next_ws: u64,
    next_output: u64,
    /// Persisted default for newly created workspaces (KDE `defaultTiled`
    /// parity, initially true). Live default edits affect only workspaces
    /// created after the edit; existing entries keep their session state.
    /// Overrides reset on owner restart (nothing persists per workspace).
    default_tiled: bool,
    /// Session-local per-workspace tiled state, keyed by workspace id.
    /// Absent entries read as the default (see [`ManagedWorkspaces::is_tiled`]).
    tiled: BTreeMap<String, bool>,
}

impl Default for ManagedWorkspaces {
    fn default() -> Self {
        Self::new()
    }
}

impl ManagedWorkspaces {
    #[must_use]
    pub fn new() -> Self {
        Self {
            outputs: BTreeMap::new(),
            displaced: BTreeMap::new(),
            membership: BTreeMap::new(),
            next_ws: 0,
            next_output: 0,
            default_tiled: true,
            tiled: BTreeMap::new(),
        }
    }

    /// Persisted default applied to newly created workspaces only.
    #[must_use]
    pub fn default_tiled(&self) -> bool {
        self.default_tiled
    }

    /// Adopt a live default change: future workspaces seed from it, existing
    /// entries keep their session state. Returns true when the value changed.
    pub fn set_default_tiled(&mut self, value: bool) -> bool {
        if self.default_tiled == value {
            return false;
        }
        self.default_tiled = value;
        true
    }

    /// Session tiled state for one workspace. Unknown workspaces and entries
    /// without an explicit override read as the current default.
    #[must_use]
    pub fn is_tiled(&self, output: &str, workspace: &str) -> bool {
        let known = self
            .outputs
            .get(output)
            .is_some_and(|s| s.order.iter().any(|e| e.id == workspace));
        if !known {
            return self.default_tiled;
        }
        self.tiled
            .get(workspace)
            .copied()
            .unwrap_or(self.default_tiled)
    }

    /// Set the session tiled state for one workspace. Returns false and
    /// changes nothing when the workspace is unknown on the output.
    pub fn set_tiled(&mut self, output: &str, workspace: &str, tiled: bool) -> bool {
        let known = self
            .outputs
            .get(output)
            .is_some_and(|s| s.order.iter().any(|e| e.id == workspace));
        if !known {
            return false;
        }
        self.tiled.insert(workspace.to_owned(), tiled);
        true
    }

    /// Tiled state of the output's active workspace, or `None` when the
    /// output is unknown. Truthful tray scope: the caller disables the
    /// checkbox on `None`, never guesses.
    #[must_use]
    pub fn current_tiled(&self, output: &str) -> Option<bool> {
        let active = self.active_id(output)?;
        Some(self.is_tiled(output, &active))
    }

    /// Seed one workspace id from the current default when it carries no
    /// explicit session state yet.
    fn seed_mode(&mut self, id: &str) {
        let default = self.default_tiled;
        self.tiled.entry(id.to_owned()).or_insert(default);
    }

    /// Drop session state for workspaces that no longer exist.
    fn prune_modes(&mut self) {
        let live: BTreeSet<String> = self
            .outputs
            .values()
            .flat_map(|s| s.order.iter().map(|e| e.id.clone()))
            .collect();
        self.tiled.retain(|id, _| live.contains(id));
    }

    pub fn ensure_output(&mut self, key: &str) -> &mut OutputState {
        if !self.outputs.contains_key(key) {
            self.next_output += 1;
            let token = format!("o{}", self.next_output);
            let mut state = OutputState {
                key: key.to_owned(),
                token,
                order: Vec::new(),
                active: 0,
            };
            for _ in 0..policy::MIN_WORKSPACES {
                self.next_ws += 1;
                let id = format!("ws-{}", self.next_ws);
                self.seed_mode(&id);
                state.order.push(WorkspaceEntry {
                    id,
                    token: format!("ws{}", self.next_ws),
                    members: BTreeSet::new(),
                    last_focus: None,
                });
            }
            self.outputs.insert(key.to_owned(), state);
        }
        self.outputs.get_mut(key).expect("ensured output")
    }

    #[must_use]
    pub fn workspace_count(&self, output: &str) -> usize {
        self.outputs.get(output).map_or(0, |o| o.order.len())
    }

    #[must_use]
    pub fn active_id(&self, output: &str) -> Option<String> {
        self.outputs
            .get(output)
            .and_then(|o| o.order.get(o.active).map(|w| w.id.clone()))
    }

    /// Activate one workspace by id without disturbing order. Returns false
    /// when the output or workspace is unknown.
    pub fn activate(&mut self, output: &str, workspace: &str) -> bool {
        let Some(state) = self.outputs.get_mut(output) else {
            return false;
        };
        let Some(pos) = state.order.iter().position(|e| e.id == workspace) else {
            return false;
        };
        state.active = pos;
        true
    }

    pub fn select(&mut self, output: &str, index: u8) -> Option<String> {
        let state = self.outputs.get_mut(output)?;
        let pos = policy::select_existing(state.order.len(), index)?;
        state.active = pos;
        Some(state.order[pos].id.clone())
    }

    pub fn select_trailing(&mut self, output: &str) -> Option<(String, bool)> {
        let reuse = self.outputs.get_mut(output).and_then(|state| {
            if state.order.is_empty() {
                return None;
            }
            let last = state.order.len() - 1;
            if state.order[last].members.is_empty() {
                state.active = last;
                Some(state.order[last].id.clone())
            } else {
                None
            }
        });
        if let Some(id) = reuse {
            return Some((id, false));
        }
        if self.outputs.get(output).is_none_or(|s| s.order.is_empty()) {
            return None;
        }
        self.next_ws += 1;
        let id = format!("ws-{}", self.next_ws);
        let token = format!("ws{}", self.next_ws);
        self.seed_mode(&id);
        let state = self.outputs.get_mut(output)?;
        state.order.push(WorkspaceEntry {
            id: id.clone(),
            token,
            members: BTreeSet::new(),
            last_focus: None,
        });
        state.active = state.order.len() - 1;
        Some((id, true))
    }

    #[must_use]
    pub fn resolve_send(&self, output: &str, index: u8) -> Option<String> {
        let state = self.outputs.get(output)?;
        let pos = policy::resolve_send_target(state.order.len(), index)?;
        Some(state.order[pos].id.clone())
    }

    pub fn resolve_send_trailing(&mut self, output: &str) -> Option<(String, bool)> {
        let reuse = self.outputs.get(output).and_then(|state| {
            if state.order.is_empty() {
                return None;
            }
            let last = state.order.len() - 1;
            if state.order[last].members.is_empty() {
                Some(state.order[last].id.clone())
            } else {
                None
            }
        });
        if let Some(id) = reuse {
            return Some((id, false));
        }
        if self.outputs.get(output).is_none_or(|s| s.order.is_empty()) {
            return None;
        }
        self.next_ws += 1;
        let id = format!("ws-{}", self.next_ws);
        let token = format!("ws{}", self.next_ws);
        self.seed_mode(&id);
        let state = self.outputs.get_mut(output)?;
        state.order.push(WorkspaceEntry {
            id: id.clone(),
            token,
            members: BTreeSet::new(),
            last_focus: None,
        });
        Some((id, true))
    }

    /// Assign a window; returns false and changes nothing when the workspace
    /// does not exist on the output.
    pub fn assign(
        &mut self,
        window: WindowKey,
        output: &str,
        workspace: &str,
        hidden: bool,
    ) -> bool {
        let known = self
            .outputs
            .get(output)
            .is_some_and(|s| s.order.iter().any(|e| e.id == workspace));
        if !known {
            return false;
        }
        for state in self.outputs.values_mut() {
            for entry in &mut state.order {
                entry.members.remove(&window);
            }
        }
        if let Some(state) = self.outputs.get_mut(output)
            && let Some(entry) = state.order.iter_mut().find(|e| e.id == workspace)
        {
            entry.members.insert(window.clone());
        }
        self.membership.insert(
            window,
            MemberLoc {
                output: output.to_owned(),
                workspace: workspace.to_owned(),
                hidden,
            },
        );
        true
    }

    pub fn set_hidden(&mut self, window: &WindowKey, hidden: bool) {
        if let Some(loc) = self.membership.get_mut(window) {
            loc.hidden = hidden;
        }
    }

    #[must_use]
    pub fn member_loc(&self, window: &WindowKey) -> Option<&MemberLoc> {
        self.membership.get(window)
    }

    #[must_use]
    pub fn is_hidden(&self, window: &WindowKey) -> bool {
        self.membership.get(window).is_some_and(|l| l.hidden)
    }

    pub fn note_foreground(&mut self, window: &WindowKey) {
        let Some(loc) = self.membership.get(window).cloned() else {
            return;
        };
        if let Some(state) = self.outputs.get_mut(&loc.output)
            && let Some(entry) = state.order.iter_mut().find(|e| e.id == loc.workspace)
        {
            entry.last_focus = Some(window.clone());
        }
    }

    #[must_use]
    pub fn focus_target(
        &self,
        output: &str,
        workspace: &str,
        visible: &BTreeSet<WindowKey>,
    ) -> Option<WindowKey> {
        let state = self.outputs.get(output)?;
        let entry = state.order.iter().find(|e| e.id == workspace)?;
        if let Some(last) = &entry.last_focus
            && entry.members.contains(last)
            && visible.contains(last)
        {
            return Some(last.clone());
        }
        entry.members.iter().find(|w| visible.contains(*w)).cloned()
    }

    /// Post-reveal eligible visible set for focus: non-hidden members whose
    /// Engine token is present in the fresh focus observation. The caller
    /// unions eligible-observed tokens with verified retained maximized
    /// tokens (focus-only; geometry still excludes them), so a maximized
    /// mover stays focusable. Pure so the fresh-focus regression pins it
    /// without native calls: pre-switch membership alone is never fresh
    /// enough, and hidden/frameless members without a fresh token never
    /// take focus.
    #[must_use]
    pub fn eligible_focus_set(
        &self,
        members: &BTreeSet<WindowKey>,
        member_tokens: &BTreeMap<WindowKey, String>,
        fresh_tokens: &HashSet<String>,
    ) -> BTreeSet<WindowKey> {
        members
            .iter()
            .filter(|k| !self.is_hidden(k))
            .filter(|k| {
                member_tokens
                    .get(*k)
                    .is_some_and(|t| fresh_tokens.contains(t))
            })
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn select_for_foreground(&self, window: &WindowKey) -> Option<(String, String)> {
        let loc = self.membership.get(window)?;
        if !loc.hidden {
            return None;
        }
        Some((loc.output.clone(), loc.workspace.clone()))
    }

    pub fn plan_cleanup(
        &self,
        output: &str,
        visible_ids: &[String],
        retained_ids: &[String],
    ) -> (Vec<String>, bool) {
        self.plan_cleanup_excluding(output, visible_ids, retained_ids, &BTreeSet::new())
    }

    /// Trailing-empty plan that never lets sticky members occupy their backing
    /// workspace (KDE `occupiedIds` global-sticky exclusion parity). Sticky
    /// members stay members but count as empty for occupancy, so a
    /// sticky-only workspace prunes like an empty one while the sticky float
    /// state itself is retained by the owner tables. Pure over the same
    /// policy as [`ManagedWorkspaces::plan_cleanup`].
    pub fn plan_cleanup_excluding(
        &self,
        output: &str,
        visible_ids: &[String],
        retained_ids: &[String],
        sticky: &BTreeSet<WindowKey>,
    ) -> (Vec<String>, bool) {
        let Some(state) = self.outputs.get(output) else {
            return (Vec::new(), false);
        };
        let facts: Vec<policy::WorkspaceFacts> = state
            .order
            .iter()
            .map(|e| {
                let non_sticky_empty = e.members.iter().all(|m| sticky.contains(m));
                let occupied = (!e.members.is_empty() && !non_sticky_empty)
                    || self.membership.iter().any(|(k, l)| {
                        l.output == output && l.workspace == e.id && !sticky.contains(k)
                    });
                policy::WorkspaceFacts {
                    empty: non_sticky_empty && !occupied,
                    visible: visible_ids.iter().any(|v| v == &e.id),
                    occupied,
                    retained: retained_ids.iter().any(|r| r == &e.id)
                        || self
                            .displaced
                            .values()
                            .any(|d| d.workspace_ids.contains(&e.id)),
                }
            })
            .collect();
        let plan = policy::plan_trailing(&facts);
        let removed: Vec<String> = plan
            .remove
            .iter()
            .map(|&i| state.order[i].id.clone())
            .collect();
        (removed, plan.need_append)
    }

    pub fn apply_cleanup(&mut self, output: &str, removed: &[String], append: bool) {
        let active_id = self.active_id(output);
        let mut seeded: Vec<String> = Vec::new();
        if let Some(state) = self.outputs.get_mut(output) {
            state.order.retain(|e| !removed.contains(&e.id));
            if append {
                self.next_ws += 1;
                let id = format!("ws-{}", self.next_ws);
                let token = format!("ws{}", self.next_ws);
                seeded.push(id.clone());
                state.order.push(WorkspaceEntry {
                    id,
                    token,
                    members: BTreeSet::new(),
                    last_focus: None,
                });
            }
            while state.order.len() < policy::MIN_WORKSPACES {
                self.next_ws += 1;
                let id = format!("ws-{}", self.next_ws);
                let token = format!("ws{}", self.next_ws);
                seeded.push(id.clone());
                state.order.push(WorkspaceEntry {
                    id,
                    token,
                    members: BTreeSet::new(),
                    last_focus: None,
                });
            }
            state.active = active_id
                .and_then(|id| state.order.iter().position(|e| e.id == id))
                .unwrap_or(0)
                .min(state.order.len().saturating_sub(1));
        }
        for id in &seeded {
            self.seed_mode(id);
        }
        self.prune_modes();
        let live: BTreeSet<String> = self
            .outputs
            .values()
            .flat_map(|s| s.order.iter().map(|e| e.id.clone()))
            .collect();
        for record in self.displaced.values_mut() {
            record.workspace_ids.retain(|id| live.contains(id));
        }
        self.displaced.retain(|_, r| !r.workspace_ids.is_empty());
    }

    /// Move whole workspaces from origin onto a caller-selected survivor.
    /// The caller chooses the survivor (via the core chooser when
    /// disconnect-time geometry is available). Returns false when origin or
    /// destination is missing, or both are the same.
    pub fn displace_output_to(&mut self, origin: &str, dest: &str) -> bool {
        if origin == dest || !self.outputs.contains_key(origin) || !self.outputs.contains_key(dest)
        {
            return false;
        }
        let ids: Vec<String> = self
            .outputs
            .get(origin)
            .map(|s| s.order.iter().map(|e| e.id.clone()).collect())
            .unwrap_or_default();
        if ids.is_empty() {
            self.outputs.remove(origin);
            return true;
        }
        let moving: Vec<WorkspaceEntry> = self
            .outputs
            .get_mut(origin)
            .map(|s| std::mem::take(&mut s.order))
            .unwrap_or_default();
        self.outputs.remove(origin);
        for window in self.membership.values_mut() {
            if window.output == origin && ids.contains(&window.workspace) {
                window.output = dest.to_owned();
            }
        }
        if let Some(state) = self.outputs.get_mut(dest) {
            state.order.extend(moving);
        }
        self.displaced.insert(
            origin.to_owned(),
            DisplacedRecord {
                workspace_ids: ids,
                dest_key: dest.to_owned(),
            },
        );
        true
    }

    /// Return displaced workspaces to the exact origin key with current
    /// contents. Creates the origin without baseline empties so no duplicate
    /// trailing/min entries appear; active points at the first returning
    /// workspace.
    pub fn reconnect_output(&mut self, origin: &str) -> bool {
        let Some(record) = self.displaced.get(origin).cloned() else {
            return false;
        };
        let Some(dest_state) = self.outputs.get_mut(&record.dest_key) else {
            return false;
        };
        let mut returning = Vec::new();
        dest_state.order.retain(|e| {
            if record.workspace_ids.contains(&e.id) {
                returning.push(e.clone());
                false
            } else {
                true
            }
        });
        if dest_state.active >= dest_state.order.len() {
            dest_state.active = dest_state.order.len().saturating_sub(1);
        }
        for window in self.membership.values_mut() {
            if window.output == record.dest_key && record.workspace_ids.contains(&window.workspace)
            {
                window.output = origin.to_owned();
            }
        }
        if self.outputs.contains_key(origin) {
            if let Some(state) = self.outputs.get_mut(origin) {
                for entry in returning {
                    if !state.order.iter().any(|e| e.id == entry.id) {
                        state.order.push(entry);
                    }
                }
            }
        } else {
            self.next_output += 1;
            let token = format!("o{}", self.next_output);
            self.outputs.insert(
                origin.to_owned(),
                OutputState {
                    key: origin.to_owned(),
                    token,
                    order: returning,
                    active: 0,
                },
            );
        }
        // Returning workspaces keep their stored session state; ids without
        // one seed from the current default (never a stale foreign value).
        for id in &record.workspace_ids {
            self.seed_mode(id);
        }
        self.displaced.remove(origin);
        true
    }

    #[must_use]
    pub fn workspace_members(&self, output: &str, workspace: &str) -> BTreeSet<WindowKey> {
        self.outputs
            .get(output)
            .and_then(|s| s.order.iter().find(|e| e.id == workspace))
            .map(|e| e.members.clone())
            .unwrap_or_default()
    }

    #[must_use]
    pub fn output_keys(&self) -> Vec<String> {
        self.outputs.keys().cloned().collect()
    }

    #[must_use]
    pub fn workspace_ids(&self, output: &str) -> Vec<String> {
        self.outputs
            .get(output)
            .map(|s| s.order.iter().map(|e| e.id.clone()).collect())
            .unwrap_or_default()
    }

    #[must_use]
    pub fn active_index(&self, output: &str) -> Option<usize> {
        self.outputs.get(output).map(|s| s.active)
    }

    /// Forget one window everywhere (close cleanup). Hidden retention is
    /// owned by the caller ledger table; this only drops session membership.
    /// Returns true when the window was known.
    pub fn remove_window(&mut self, window: &WindowKey) -> bool {
        let mut known = false;
        for state in self.outputs.values_mut() {
            for entry in &mut state.order {
                if entry.members.remove(window) {
                    known = true;
                }
                if entry.last_focus.as_ref() == Some(window) {
                    entry.last_focus = None;
                }
            }
        }
        if self.membership.remove(window).is_some() {
            known = true;
        }
        known
    }

    #[must_use]
    pub fn displaced_snapshot(&self) -> BTreeMap<String, DisplacedRecord> {
        self.displaced.clone()
    }

    #[must_use]
    pub fn output_token(&self, output: &str) -> String {
        self.outputs
            .get(output)
            .map(|s| s.token.clone())
            .unwrap_or_else(|| "o?".to_owned())
    }

    #[must_use]
    pub fn workspace_token(&self, output: &str, workspace: &str) -> String {
        self.outputs
            .get(output)
            .and_then(|s| s.order.iter().find(|e| e.id == workspace))
            .map(|e| e.token.clone())
            .unwrap_or_else(|| "ws?".to_owned())
    }
}

#[must_use]
pub fn verify_send_follow(
    mover: &WindowKey,
    source_members: &BTreeSet<WindowKey>,
    target_members: &BTreeSet<WindowKey>,
) -> bool {
    !source_members.contains(mover) && target_members.contains(mover)
}

/// Unconfirmed workspace-domain releases (workspace-mode toggle edges).
/// Keyed by `(output, workspace)`: the latest intent wins, so a failed float
/// release followed by a successful retile leaves no stale float entry that
/// a later retry could fire at the retiled layout. A confirmed toggle clears
/// its domain entry. A pending entry is stale once its workspace reads tiled
/// again: both intents imply a floating workspace, so a tiled workspace must
/// never release.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PendingReleases {
    inner: BTreeMap<(String, String), bool>,
}

impl PendingReleases {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            inner: BTreeMap::new(),
        }
    }

    /// Queue the latest intent for one domain, overwriting any earlier one.
    pub fn queue(&mut self, output: &str, workspace: &str, retile: bool) {
        self.inner
            .insert((output.to_owned(), workspace.to_owned()), retile);
    }

    /// Drop the entry for one domain after its release confirms (or after a
    /// successful toggle that supersedes it). Returns true when one existed.
    pub fn confirm(&mut self, output: &str, workspace: &str) -> bool {
        self.inner
            .remove(&(output.to_owned(), workspace.to_owned()))
            .is_some()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Snapshot of pending `(output, workspace, retile)` intents.
    #[must_use]
    pub fn snapshot(&self) -> Vec<(String, String, bool)> {
        self.inner
            .iter()
            .map(|((o, w), r)| (o.clone(), w.clone(), *r))
            .collect()
    }

    /// True when the intent must not fire: the workspace is known and reads
    /// tiled, so releasing would destroy the live tiled layout. Unknown
    /// workspaces are not stale (an empty-rows release still cleans up).
    #[must_use]
    pub const fn is_stale(tiled: Option<bool>) -> bool {
        matches!(tiled, Some(true))
    }
}

/// Topology fingerprint for pending-release retries: monitor devices plus
/// work/full rects, workspace order per output, member identities, and the
/// raw HWND inventory size. Retries fire only when this changes, so a pending
/// release never polls or logs on quiet ticks.
///
/// Rectangles ride as packed `(x, y, w, h)` tuples so the inputs stay
/// `Ord` for the canonical sort.
pub type TopologyArea = (String, (i32, i32, i32, i32), (i32, i32, i32, i32));

#[must_use]
pub fn topology_fingerprint(
    areas: &[TopologyArea],
    workspaces: &[(String, Vec<String>)],
    members: &[WindowKey],
    hwnd_count: usize,
) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    let mut sorted_areas = areas.to_vec();
    sorted_areas.sort();
    sorted_areas.hash(&mut hasher);
    let mut sorted_ws = workspaces.to_vec();
    sorted_ws.sort();
    sorted_ws.hash(&mut hasher);
    let mut sorted_members = members.to_vec();
    sorted_members.sort();
    sorted_members.hash(&mut hasher);
    hwnd_count.hash(&mut hasher);
    hasher.finish()
}

#[must_use]
pub fn workspace_event(
    output_token: &str,
    workspace_token: &str,
    members: usize,
    action: &str,
    outcome: &str,
) -> serde_json::Value {
    serde_json::json!({
        "event": "workspace",
        "output": output_token,
        "workspace": workspace_token,
        "members": members,
        "action": action,
        "outcome": outcome,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(hwnd: u64) -> WindowKey {
        WindowKey {
            hwnd,
            pid: 1000 + hwnd as u32,
            creation: format!("c{hwnd:016x}"),
        }
    }

    fn order_ids(m: &ManagedWorkspaces, output: &str) -> Vec<String> {
        m.outputs
            .get(output)
            .map(|s| s.order.iter().map(|e| e.id.clone()).collect())
            .unwrap_or_default()
    }

    #[test]
    fn decode_digit_alias_and_modifiers() {
        assert_eq!(
            decode_digit(VK_0 + 1, false, false, false, true),
            Some((DigitOp::Select, 1))
        );
        assert_eq!(
            decode_digit(VK_0 + 1, true, false, false, true),
            Some((DigitOp::Send, 1))
        );
        assert_eq!(decode_digit(VK_0 + 1, false, true, false, true), None);
        assert_eq!(decode_digit(VK_0 + 1, false, false, true, true), None);
        assert_eq!(decode_digit(VK_0 + 1, false, false, false, false), None);
        assert_eq!(decode_digit(0x41, false, false, false, true), None);
        assert!(is_digit_vk(VK_0) && is_digit_vk(VK_9));
        assert!(!is_digit_vk(0x41));
    }

    #[test]
    fn select_existing_never_creates() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        assert_eq!(m.workspace_count("mon-1"), 2);
        let first = m.select("mon-1", 1).expect("select 1");
        assert_eq!(m.active_id("mon-1").as_deref(), Some(first.as_str()));
        assert!(m.select("mon-1", 9).is_none());
        assert_eq!(m.workspace_count("mon-1"), 2);
    }

    #[test]
    fn trailing_zero_reuses_then_creates() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let (id, created) = m.select_trailing("mon-1").expect("trailing");
        assert!(!created);
        assert_eq!(m.active_id("mon-1").as_deref(), Some(id.as_str()));
        let ids = order_ids(&m, "mon-1");
        for (i, ws) in ids.iter().enumerate() {
            assert!(m.assign(key(100 + i as u64), "mon-1", ws, false));
        }
        let (_, created) = m.select_trailing("mon-1").expect("append");
        assert!(created);
        assert_eq!(m.workspace_count("mon-1"), 3);
    }

    #[test]
    fn invalid_assign_refuses_without_loss() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws1 = m.resolve_send("mon-1", 1).expect("ws1");
        let w = key(11);
        assert!(m.assign(w.clone(), "mon-1", &ws1, false));
        assert!(!m.assign(key(12), "mon-1", "ws-missing", false));
        assert!(!m.assign(key(13), "mon-missing", "ws-1", false));
        assert_eq!(m.member_loc(&w).expect("loc").workspace, ws1);
        let entry = m
            .outputs
            .get("mon-1")
            .expect("o")
            .order
            .iter()
            .find(|e| e.id == ws1)
            .expect("e");
        assert!(entry.members.contains(&w));
    }

    #[test]
    fn cleanup_preserves_active_id_across_earlier_prune() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        for i in 0..2 {
            let ids = order_ids(&m, "mon-1");
            for ws in &ids {
                let occupied = m
                    .outputs
                    .get("mon-1")
                    .expect("o")
                    .order
                    .iter()
                    .find(|e| &e.id == ws)
                    .expect("e")
                    .members
                    .is_empty();
                if occupied {
                    assert!(m.assign(key(500 + i), "mon-1", ws, false));
                    break;
                }
            }
            let _ = m.select_trailing("mon-1");
        }
        let active = m.active_id("mon-1").expect("active");
        let (removed, append) = m.plan_cleanup("mon-1", std::slice::from_ref(&active), &[]);
        assert!(!removed.contains(&active));
        m.apply_cleanup("mon-1", &removed, append);
        assert_eq!(m.active_id("mon-1").as_deref(), Some(active.as_str()));
        assert!(m.workspace_count("mon-1") >= policy::MIN_WORKSPACES);
    }

    #[test]
    fn activate_by_id_covers_trailing_past_ordinals() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        // Fill every workspace so trailing appends past the Win1..9 range.
        for i in 0..10 {
            let ids = order_ids(&m, "mon-1");
            for ws in &ids {
                let occupied = m
                    .outputs
                    .get("mon-1")
                    .expect("o")
                    .order
                    .iter()
                    .find(|e| &e.id == ws)
                    .expect("e")
                    .members
                    .is_empty();
                if occupied {
                    assert!(m.assign(key(900 + i), "mon-1", ws, false));
                    break;
                }
            }
            let _ = m.select_trailing("mon-1");
        }
        assert!(m.workspace_count("mon-1") > 9);
        let last = order_ids(&m, "mon-1").last().cloned().expect("last");
        let first = order_ids(&m, "mon-1").first().cloned().expect("first");
        assert!(m.activate("mon-1", &last));
        assert_eq!(m.active_id("mon-1").as_deref(), Some(last.as_str()));
        assert!(m.activate("mon-1", &first));
        assert_eq!(m.active_id("mon-1").as_deref(), Some(first.as_str()));
        assert!(!m.activate("mon-1", "ws-missing"));
        assert!(!m.activate("mon-missing", &first));
    }

    #[test]
    fn per_output_isolation() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        m.ensure_output("mon-2");
        m.select("mon-1", 2);
        assert_eq!(m.outputs.get("mon-1").expect("a").active, 1);
        assert_eq!(m.outputs.get("mon-1").expect("a").active, 1);
        let a = m.resolve_send("mon-1", 1).expect("send target");
        let b = m.resolve_send("mon-2", 1).expect("send target");
        assert_ne!(a, b);
    }

    #[test]
    fn hidden_members_retained_and_foreground_selects_hidden() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let target = m.resolve_send("mon-1", 2).expect("ws2");
        let w = key(42);
        assert!(m.assign(w.clone(), "mon-1", &target, false));
        m.set_hidden(&w, true);
        assert!(m.is_hidden(&w));
        assert_eq!(m.member_loc(&w).expect("loc").workspace, target);
        let selected = m.select_for_foreground(&w).expect("foreground select");
        assert_eq!(selected, ("mon-1".to_owned(), target.clone()));
        let v = key(43);
        assert!(m.assign(v.clone(), "mon-1", &target, false));
        assert_eq!(m.select_for_foreground(&v), None);
    }

    #[test]
    fn focus_target_avoids_hidden_previous() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws1 = m.resolve_send("mon-1", 1).expect("ws1");
        let ws2 = m.resolve_send("mon-1", 2).expect("ws2");
        let a = key(1);
        let b = key(2);
        assert!(m.assign(a.clone(), "mon-1", &ws2, false));
        assert!(m.assign(b.clone(), "mon-1", &ws2, false));
        m.note_foreground(&a);
        m.set_hidden(&a, true);
        let visible: BTreeSet<WindowKey> = [b.clone()].into_iter().collect();
        assert_eq!(m.focus_target("mon-1", &ws2, &visible), Some(b));
        assert_eq!(m.focus_target("mon-1", &ws1, &BTreeSet::new()), None);
    }

    #[test]
    fn send_follow_refuses_stale_and_wrong_target() {
        let mover = key(7);
        let other = key(8);
        let source: BTreeSet<WindowKey> = [other.clone()].into_iter().collect();
        let target: BTreeSet<WindowKey> = [mover.clone(), other.clone()].into_iter().collect();
        assert!(verify_send_follow(&mover, &source, &target));
        let source: BTreeSet<WindowKey> = [mover.clone()].into_iter().collect();
        assert!(!verify_send_follow(&mover, &source, &target));
        let target: BTreeSet<WindowKey> = [other].into_iter().collect();
        assert!(!verify_send_follow(&mover, &BTreeSet::new(), &target));
    }

    #[test]
    fn cleanup_floor_keeps_minimum_two() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let active = m.active_id("mon-1").expect("active");
        // Both workspaces empty and invisible: the floor keeps both.
        let (removed, append) = m.plan_cleanup("mon-1", &[], &[]);
        m.apply_cleanup("mon-1", &removed, append);
        assert!(m.workspace_count("mon-1") >= policy::MIN_WORKSPACES);
        assert!(m.active_id("mon-1").is_some());
        let _ = active;
    }

    #[test]
    fn hidden_members_retain_workspace_through_cleanup() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws2 = m.resolve_send("mon-1", 2).expect("ws2");
        let w = key(77);
        assert!(m.assign(w.clone(), "mon-1", &ws2, false));
        m.set_hidden(&w, true);
        let active = m.active_id("mon-1").expect("active");
        // The hidden-occupied workspace is protected from pruning.
        let (removed, append) = m.plan_cleanup("mon-1", std::slice::from_ref(&active), &[]);
        assert!(!removed.contains(&ws2));
        m.apply_cleanup("mon-1", &removed, append);
        assert_eq!(m.member_loc(&w).expect("loc").workspace, ws2);
        assert!(m.is_hidden(&w));
    }

    #[test]
    fn last_focus_is_per_workspace() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws1 = m.resolve_send("mon-1", 1).expect("ws1");
        let ws2 = m.resolve_send("mon-1", 2).expect("ws2");
        let a = key(101);
        let b = key(102);
        assert!(m.assign(a.clone(), "mon-1", &ws1, false));
        assert!(m.assign(b.clone(), "mon-1", &ws2, false));
        m.note_foreground(&a);
        m.note_foreground(&b);
        let visible_a: BTreeSet<WindowKey> = [a.clone()].into_iter().collect();
        let visible_b: BTreeSet<WindowKey> = [b.clone()].into_iter().collect();
        assert_eq!(m.focus_target("mon-1", &ws1, &visible_a), Some(a));
        assert_eq!(m.focus_target("mon-1", &ws2, &visible_b), Some(b));
    }

    #[test]
    fn remove_window_cleans_membership_and_focus() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws1 = m.resolve_send("mon-1", 1).expect("ws1");
        let w = key(21);
        assert!(m.assign(w.clone(), "mon-1", &ws1, false));
        m.note_foreground(&w);
        assert!(m.remove_window(&w));
        assert!(m.member_loc(&w).is_none());
        assert!(!m.remove_window(&w));
    }

    #[test]
    fn displaced_units_never_merge_and_return_without_baseline() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        m.ensure_output("mon-2");
        let before = m.workspace_count("mon-2");
        let returning_len = m.workspace_count("mon-1");
        let w = key(99);
        let ws2 = m.resolve_send("mon-1", 2).expect("ws2");
        assert!(m.assign(w, "mon-1", &ws2, false));
        assert!(m.displace_output_to("mon-1", "mon-2"));
        assert!(!m.outputs.contains_key("mon-1"));
        assert!(!m.displace_output_to("mon-1", "mon-2"));
        assert!(!m.displace_output_to("mon-2", "mon-2"));
        assert!(m.reconnect_output("mon-1"));
        assert_eq!(
            m.workspace_count("mon-1"),
            returning_len,
            "no baseline duplicates"
        );
        assert_eq!(m.workspace_count("mon-2"), before);
        assert!(m.active_id("mon-1").is_some());
        assert!(!m.reconnect_output("mon-1-replaced"));
    }

    #[test]
    fn workspace_event_is_opaque() {
        let ev = workspace_event("o1", "ws2", 3, "select", "ok");
        assert_eq!(ev["output"], serde_json::Value::from("o1"));
        assert_eq!(ev["members"], serde_json::Value::from(3));
        let text = ev.to_string();
        assert!(!text.contains("hwnd") && !text.contains("pid"));
    }

    #[test]
    fn select_resolution_does_not_preactivate() {
        // Regression for `workspace_tick` mutating ACTIVE via
        // `select`/`select_trailing` before `workspace_do_select` reads
        // current (which then reports `already-active` with no native
        // effects). Select targets must resolve without activating; only the
        // transition itself activates after hide/reveal.
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let before = m.active_id("mon-1").expect("active");
        let target = m.resolve_send("mon-1", 2).expect("resolve");
        assert_ne!(before, target);
        assert_eq!(
            m.active_id("mon-1").as_deref(),
            Some(before.as_str()),
            "resolve_send must not preactivate"
        );
        let before = m.active_id("mon-1").expect("active");
        let (trailing, _) = m.resolve_send_trailing("mon-1").expect("trailing");
        assert_eq!(
            m.active_id("mon-1").as_deref(),
            Some(before.as_str()),
            "resolve_send_trailing must not preactivate"
        );
        assert!(m.activate("mon-1", &trailing));
        assert_eq!(m.active_id("mon-1").as_deref(), Some(trailing.as_str()));
    }

    #[test]
    fn eligible_focus_uses_only_fresh_observation() {
        // Post-reveal focus must use the fresh eligible observation, never the
        // pre-switch membership alone: hidden and frameless members without a
        // fresh token never take focus, and the last appropriate fresh member
        // wins.
        use std::collections::{BTreeMap, HashSet};
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws2 = m.resolve_send("mon-1", 2).expect("ws2");
        let a = key(1);
        let b = key(2);
        assert!(m.assign(a.clone(), "mon-1", &ws2, false));
        assert!(m.assign(b.clone(), "mon-1", &ws2, false));
        m.note_foreground(&a);
        m.set_hidden(&a, true);
        let mut member_tokens: BTreeMap<WindowKey, String> = BTreeMap::new();
        member_tokens.insert(a.clone(), "tok-a".to_owned());
        member_tokens.insert(b.clone(), "tok-b".to_owned());
        // Only `b` is freshly observed eligible; `a` stays hidden.
        let fresh: HashSet<String> = ["tok-b".to_owned()].into_iter().collect();
        let members: BTreeSet<WindowKey> = [a.clone(), b.clone()].into_iter().collect();
        let eligible = m.eligible_focus_set(&members, &member_tokens, &fresh);
        assert_eq!(eligible, [b.clone()].into_iter().collect());
        assert_eq!(m.focus_target("mon-1", &ws2, &eligible), Some(b));
        // Empty fresh observation means an empty target: no focus.
        let empty = m.eligible_focus_set(&members, &member_tokens, &HashSet::new());
        assert!(empty.is_empty());
        assert_eq!(m.focus_target("mon-1", &ws2, &empty), None);
    }

    #[test]
    fn eligible_focus_includes_retained_maximized_token() {
        // A maximized mover is retained, never eligible-observed: the caller
        // unions its verified retained token into the fresh focus set (focus
        // only; geometry still excludes it), so the follow/return focus
        // target resolves to the maximized member with exact foreground proof.
        use std::collections::{BTreeMap, HashSet};
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws2 = m.resolve_send("mon-1", 2).expect("ws2");
        let maxed = key(1);
        let sibling = key(2);
        assert!(m.assign(maxed.clone(), "mon-1", &ws2, false));
        assert!(m.assign(sibling.clone(), "mon-1", &ws2, false));
        m.note_foreground(&maxed);
        let mut member_tokens: BTreeMap<WindowKey, String> = BTreeMap::new();
        member_tokens.insert(maxed.clone(), "tok-max".to_owned());
        member_tokens.insert(sibling.clone(), "tok-sib".to_owned());
        let members: BTreeSet<WindowKey> = [maxed.clone(), sibling.clone()].into_iter().collect();
        // Eligible-only set misses the retained maximized member.
        let eligible_only: HashSet<String> = ["tok-sib".to_owned()].into_iter().collect();
        let eligible = m.eligible_focus_set(&members, &member_tokens, &eligible_only);
        assert_eq!(eligible, [sibling.clone()].into_iter().collect());
        // Retained-inclusive focus set (production union) keeps both; the
        // last-focus maximized mover wins the follow target.
        let focus_fresh: HashSet<String> = ["tok-sib".to_owned(), "tok-max".to_owned()]
            .into_iter()
            .collect();
        let focus_eligible = m.eligible_focus_set(&members, &member_tokens, &focus_fresh);
        assert_eq!(
            focus_eligible,
            [maxed.clone(), sibling.clone()].into_iter().collect()
        );
        assert_eq!(m.focus_target("mon-1", &ws2, &focus_eligible), Some(maxed));
    }

    #[test]
    fn sticky_only_intermediate_workspace_prunes_but_keeps_membership() {
        // Sticky members never occupy: a sticky-only intermediate workspace is
        // reported removed like an empty one, while the sticky membership
        // itself survives in the owner tables (retained float, rehomed by the
        // next sticky-off, dropped only by the member-drop path).
        use std::collections::BTreeSet;
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let first = m.active_id("mon-1").expect("active");
        let second = m.resolve_send("mon-1", 2).expect("second");
        // Occupy the trailing slot so a third workspace appends, leaving the
        // sticky-only second workspace intermediate (prunable, not floored).
        let normal_win = key(42);
        assert!(m.assign(normal_win.clone(), "mon-1", &second, false));
        let (third, _) = m.select_trailing("mon-1").expect("trailing");
        assert!(m.assign(normal_win.clone(), "mon-1", &third, false));
        let sticky_win = key(41);
        assert!(m.assign(sticky_win.clone(), "mon-1", &second, false));
        assert!(m.activate("mon-1", &first));
        let sticky: BTreeSet<WindowKey> = [sticky_win.clone()].into_iter().collect();
        // Without exclusion the intermediate workspace looks occupied and
        // survives; with sticky exclusion it is reported removed.
        let (kept, _) = m.plan_cleanup("mon-1", std::slice::from_ref(&first), &[]);
        assert!(
            !kept.contains(&second),
            "occupied intermediate survives, got {kept:?}"
        );
        let (removed, append) =
            m.plan_cleanup_excluding("mon-1", std::slice::from_ref(&first), &[], &sticky);
        assert_eq!(removed, vec![second.clone()], "sticky-only prunes");
        m.apply_cleanup("mon-1", &removed, append);
        assert_eq!(m.active_id("mon-1").as_deref(), Some(first.as_str()));
        // Membership is untouched by the plan: the owner retains the sticky
        // float for rehome on the next sticky-off.
        assert_eq!(
            m.member_loc(&sticky_win).map(|l| l.workspace.clone()),
            Some(second.clone())
        );
    }

    #[test]
    fn plan_cleanup_excluding_matches_plain_without_sticky() {
        // No sticky members: excluding degenerates to the plain plan.
        use std::collections::BTreeSet;
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let active = m.active_id("mon-1").expect("active");
        let plain = m.plan_cleanup("mon-1", std::slice::from_ref(&active), &[]);
        let excluded = m.plan_cleanup_excluding(
            "mon-1",
            std::slice::from_ref(&active),
            &[],
            &BTreeSet::new(),
        );
        assert_eq!(plain, excluded);
    }

    #[test]
    fn workspace_mode_defaults_tiled_and_toggles_per_workspace() {
        let mut m = ManagedWorkspaces::new();
        assert!(m.default_tiled());
        m.ensure_output("mon-1");
        let ws1 = m.resolve_send("mon-1", 1).expect("ws1");
        let ws2 = m.resolve_send("mon-1", 2).expect("ws2");
        assert!(m.is_tiled("mon-1", &ws1));
        assert!(m.is_tiled("mon-1", &ws2));
        assert!(m.set_tiled("mon-1", &ws1, false));
        assert!(!m.is_tiled("mon-1", &ws1));
        assert!(m.is_tiled("mon-1", &ws2));
        assert!(!m.set_tiled("mon-1", "ws-missing", false));
        assert!(!m.set_tiled("mon-missing", &ws1, false));
    }

    #[test]
    fn live_default_applies_only_to_future_workspaces() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws1 = m.resolve_send("mon-1", 1).expect("ws1");
        assert!(m.set_default_tiled(false));
        assert!(!m.set_default_tiled(false));
        // Existing workspaces keep their session state.
        assert!(m.is_tiled("mon-1", &ws1));
        // New workspaces seed from the live default.
        m.ensure_output("mon-2");
        let other = m.resolve_send("mon-2", 1).expect("other");
        assert!(!m.is_tiled("mon-2", &other));
        // Unknown workspaces read as the current default.
        assert!(!m.is_tiled("mon-2", "ws-missing"));
    }

    #[test]
    fn current_tiled_is_none_without_scope() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        assert_eq!(m.current_tiled("mon-1"), Some(true));
        assert_eq!(m.current_tiled("mon-missing"), None);
        let active = m.active_id("mon-1").expect("active");
        assert!(m.set_tiled("mon-1", &active, false));
        assert_eq!(m.current_tiled("mon-1"), Some(false));
    }

    #[test]
    fn cleanup_prunes_mode_state_with_workspaces() {
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let first = m.active_id("mon-1").expect("active");
        let second = m.resolve_send("mon-1", 2).expect("second");
        assert!(m.set_tiled("mon-1", &second, false));
        // An empty intermediate workspace prunes while survivors keep their
        // own session state; the pruned floating state leaves with it.
        assert!(m.assign(key(5), "mon-1", &first, false));
        assert!(m.assign(key(6), "mon-1", &second, false));
        let (third, created) = m.select_trailing("mon-1").expect("trailing");
        assert!(created);
        assert!(m.assign(key(6), "mon-1", &third, false));
        assert!(m.activate("mon-1", &first));
        let sticky: BTreeSet<WindowKey> = BTreeSet::new();
        let (removed, append) =
            m.plan_cleanup_excluding("mon-1", std::slice::from_ref(&first), &[], &sticky);
        assert!(removed.contains(&second));
        m.apply_cleanup("mon-1", &removed, append);
        assert!(!m.tiled.contains_key(&second));
        assert!(m.is_tiled("mon-1", &first));
    }

    #[test]
    fn floating_workspaces_keep_project_membership_for_new_windows() {
        // New windows admitted to a floating workspace join project
        // membership (hide/reveal scope) with frames untouched: mode never
        // gates assignment, only geometry/effects.
        let mut m = ManagedWorkspaces::new();
        m.ensure_output("mon-1");
        let ws1 = m.resolve_send("mon-1", 1).expect("ws1");
        assert!(m.set_tiled("mon-1", &ws1, false));
        let w = key(31);
        assert!(m.assign(w.clone(), "mon-1", &ws1, false));
        assert_eq!(m.member_loc(&w).expect("loc").workspace, ws1);
        assert!(!m.is_tiled("mon-1", &ws1));
        assert!(!m.is_hidden(&w));
    }

    #[test]
    fn pending_releases_keep_latest_intent_per_domain() {
        // A failed float release queued as non-retile is superseded by the
        // later retile intent for the same domain: exactly one entry rides,
        // so a retry can never fire the stale float at a retiled layout.
        let mut pending = PendingReleases::new();
        assert!(pending.is_empty());
        pending.queue("mon-1", "ws-1", false);
        pending.queue("mon-1", "ws-1", true);
        assert_eq!(pending.len(), 1);
        assert_eq!(
            pending.snapshot(),
            vec![("mon-1".to_owned(), "ws-1".to_owned(), true)]
        );
        // A confirmed toggle clears its domain only.
        pending.queue("mon-1", "ws-2", false);
        assert!(pending.confirm("mon-1", "ws-1"));
        assert!(!pending.confirm("mon-1", "ws-1"));
        assert_eq!(
            pending.snapshot(),
            vec![("mon-1".to_owned(), "ws-2".to_owned(), false)]
        );
    }

    #[test]
    fn pending_releases_go_stale_once_tiled() {
        // Both intents imply a floating workspace: a workspace reading tiled
        // again must never release. Unknown workspaces still release (empty
        // rows clean up the orphaned Engine session).
        assert!(PendingReleases::is_stale(Some(true)));
        assert!(!PendingReleases::is_stale(Some(false)));
        assert!(!PendingReleases::is_stale(None));
    }

    #[test]
    fn topology_fingerprint_moves_only_with_topology() {
        let areas = vec![("mon-1".to_owned(), (0, 0, 800, 600), (0, 0, 800, 600))];
        let workspaces = vec![("mon-1".to_owned(), vec!["ws-1".to_owned()])];
        let members = vec![key(1)];
        let base = topology_fingerprint(&areas, &workspaces, &members, 1);
        assert_eq!(topology_fingerprint(&areas, &workspaces, &members, 1), base);
        // Member swap at the same count still moves: a same-count change is
        // a topology edge, never a quiet tick.
        assert_ne!(
            topology_fingerprint(&areas, &workspaces, &[key(2)], 1),
            base
        );
        assert_ne!(topology_fingerprint(&areas, &workspaces, &members, 2), base);
        let moved_areas = vec![("mon-1".to_owned(), (0, 0, 1024, 768), (0, 0, 1024, 768))];
        assert_ne!(
            topology_fingerprint(&moved_areas, &workspaces, &members, 1),
            base
        );
    }
}
