//! Per-output-local managed workspaces plus digit classification.

use std::collections::{BTreeMap, BTreeSet};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DigitOp {
    Select,
    Send,
}

impl DigitOp {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::Send => "send",
        }
    }
}

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

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct WindowKey {
    pub hwnd: u64,
    pub pid: u32,
    pub creation: String,
    pub tag: String,
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

#[derive(Debug, Default)]
pub struct ManagedWorkspaces {
    outputs: BTreeMap<String, OutputState>,
    displaced: BTreeMap<String, DisplacedRecord>,
    membership: BTreeMap<WindowKey, MemberLoc>,
    next_ws: u64,
    next_output: u64,
}

impl ManagedWorkspaces {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
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
                state.order.push(WorkspaceEntry {
                    id: format!("ws-{}", self.next_ws),
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

    pub fn select(&mut self, output: &str, index: u8) -> Option<String> {
        let state = self.outputs.get_mut(output)?;
        let pos = policy::select_existing(state.order.len(), index)?;
        state.active = pos;
        Some(state.order[pos].id.clone())
    }

    pub fn select_trailing(&mut self, output: &str) -> Option<(String, bool)> {
        let next_ws = &mut self.next_ws;
        let state = self.outputs.get_mut(output)?;
        if state.order.is_empty() {
            return None;
        }
        let last = state.order.len() - 1;
        if state.order[last].members.is_empty() {
            state.active = last;
            return Some((state.order[last].id.clone(), false));
        }
        *next_ws += 1;
        let id = format!("ws-{next_ws}");
        state.order.push(WorkspaceEntry {
            id: id.clone(),
            token: format!("ws{next_ws}"),
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
        let next_ws = &mut self.next_ws;
        let state = self.outputs.get_mut(output)?;
        if state.order.is_empty() {
            return None;
        }
        let last = state.order.len() - 1;
        if state.order[last].members.is_empty() {
            return Some((state.order[last].id.clone(), false));
        }
        *next_ws += 1;
        let id = format!("ws-{next_ws}");
        state.order.push(WorkspaceEntry {
            id: id.clone(),
            token: format!("ws{next_ws}"),
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
        let Some(state) = self.outputs.get(output) else {
            return (Vec::new(), false);
        };
        let facts: Vec<policy::WorkspaceFacts> = state
            .order
            .iter()
            .map(|e| {
                let occupied = !e.members.is_empty()
                    || self
                        .membership
                        .values()
                        .any(|l| l.output == output && l.workspace == e.id);
                policy::WorkspaceFacts {
                    empty: e.members.is_empty() && !occupied,
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
        if let Some(state) = self.outputs.get_mut(output) {
            state.order.retain(|e| !removed.contains(&e.id));
            if append {
                self.next_ws += 1;
                state.order.push(WorkspaceEntry {
                    id: format!("ws-{}", self.next_ws),
                    token: format!("ws{}", self.next_ws),
                    members: BTreeSet::new(),
                    last_focus: None,
                });
            }
            while state.order.len() < policy::MIN_WORKSPACES {
                self.next_ws += 1;
                state.order.push(WorkspaceEntry {
                    id: format!("ws-{}", self.next_ws),
                    token: format!("ws{}", self.next_ws),
                    members: BTreeSet::new(),
                    last_focus: None,
                });
            }
            state.active = active_id
                .and_then(|id| state.order.iter().position(|e| e.id == id))
                .unwrap_or(0)
                .min(state.order.len().saturating_sub(1));
        }
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
        self.displaced.remove(origin);
        true
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DigitEdge {
    Down,
    Up,
    Repeat,
}

impl DigitEdge {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Down => "down",
            Self::Up => "up",
            Self::Repeat => "repeat",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DigitIntent {
    pub op: DigitOp,
    pub index: u8,
    pub edge: DigitEdge,
    pub foreground: bool,
    pub consumed: bool,
    pub announce: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigitClassify {
    win_l: bool,
    win_r: bool,
    shift: bool,
    ctrl: bool,
    alt: bool,
    digit_down: [bool; 10],
    digit_origin: [bool; 10],
    digit_op: [Option<DigitOp>; 10],
    pub enabled: bool,
    pub session_active: bool,
    pub down: [u32; 10],
    pub up: [u32; 10],
    pub repeat: [u32; 10],
    pub consumed: [u32; 10],
    pub passed: [u32; 10],
}

impl DigitClassify {
    #[must_use]
    pub fn new(enabled: bool, session_active: bool) -> Self {
        Self {
            win_l: false,
            win_r: false,
            shift: false,
            ctrl: false,
            alt: false,
            digit_down: [false; 10],
            digit_origin: [false; 10],
            digit_op: [None; 10],
            enabled,
            session_active,
            down: [0; 10],
            up: [0; 10],
            repeat: [0; 10],
            consumed: [0; 10],
            passed: [0; 10],
        }
    }

    pub fn set_session(&mut self, enabled: bool, session_active: bool) {
        self.enabled = enabled;
        self.session_active = session_active;
    }

    pub fn push(
        &mut self,
        vk: u32,
        is_up: bool,
        foreground: bool,
        injected: bool,
    ) -> Option<DigitIntent> {
        if injected {
            return None;
        }
        if vk == VK_LWIN || vk == VK_RWIN {
            if is_up {
                if vk == VK_LWIN {
                    self.win_l = false;
                } else {
                    self.win_r = false;
                }
            } else if vk == VK_LWIN {
                self.win_l = true;
            } else {
                self.win_r = true;
            }
            return None;
        }
        if matches!(vk, VK_SHIFT | VK_LSHIFT | VK_RSHIFT) {
            self.shift = !is_up;
            return None;
        }
        if matches!(vk, VK_CTRL | VK_LCTRL | VK_RCTRL) {
            self.ctrl = !is_up;
            return None;
        }
        if matches!(vk, VK_ALT | VK_LALT | VK_RALT) {
            self.alt = !is_up;
            return None;
        }
        if !is_digit_vk(vk) {
            return None;
        }
        let slot = (vk - VK_0) as usize;
        if is_up {
            if !self.digit_down[slot] {
                return None;
            }
            self.digit_down[slot] = false;
            let origin = self.digit_origin[slot];
            self.digit_origin[slot] = false;
            let op = self.digit_op[slot].unwrap_or(DigitOp::Select);
            self.digit_op[slot] = None;
            self.up[slot] += 1;
            if self.enabled && self.session_active && origin {
                self.consumed[slot] += 1;
                return Some(DigitIntent {
                    op,
                    index: slot as u8,
                    edge: DigitEdge::Up,
                    foreground,
                    consumed: true,
                    announce: false,
                });
            }
            self.passed[slot] += 1;
            return Some(DigitIntent {
                op,
                index: slot as u8,
                edge: DigitEdge::Up,
                foreground,
                consumed: false,
                announce: false,
            });
        }
        if self.ctrl || self.alt || !(self.win_l || self.win_r) {
            return None;
        }
        let op = if self.shift {
            DigitOp::Send
        } else {
            DigitOp::Select
        };
        if self.digit_down[slot] {
            self.repeat[slot] += 1;
            let op = self.digit_op[slot].unwrap_or(op);
            if self.enabled && self.session_active && self.digit_origin[slot] {
                self.consumed[slot] += 1;
                return Some(DigitIntent {
                    op,
                    index: slot as u8,
                    edge: DigitEdge::Repeat,
                    foreground,
                    consumed: true,
                    announce: true,
                });
            }
            self.passed[slot] += 1;
            return Some(DigitIntent {
                op,
                index: slot as u8,
                edge: DigitEdge::Repeat,
                foreground,
                consumed: false,
                announce: false,
            });
        }
        self.digit_down[slot] = true;
        let origin = self.enabled && self.session_active;
        self.digit_origin[slot] = origin;
        self.digit_op[slot] = Some(op);
        self.down[slot] += 1;
        if origin {
            self.consumed[slot] += 1;
            Some(DigitIntent {
                op,
                index: slot as u8,
                edge: DigitEdge::Down,
                foreground,
                consumed: true,
                announce: true,
            })
        } else {
            self.passed[slot] += 1;
            Some(DigitIntent {
                op,
                index: slot as u8,
                edge: DigitEdge::Down,
                foreground,
                consumed: false,
                announce: false,
            })
        }
    }
}

#[derive(Debug, Default)]
pub struct DigitQueue {
    inner: std::collections::VecDeque<DigitIntent>,
    pub dropped: u32,
}

impl DigitQueue {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: std::collections::VecDeque::with_capacity(512),
            dropped: 0,
        }
    }

    #[must_use]
    pub fn is_full(&self) -> bool {
        self.inner.len() >= 512
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn push(&mut self, intent: DigitIntent) -> bool {
        if self.is_full() {
            self.dropped += 1;
            return false;
        }
        self.inner.push_back(intent);
        true
    }

    pub fn record_drop(&mut self) {
        self.dropped += 1;
    }

    pub fn pop_front(&mut self) -> Option<DigitIntent> {
        self.inner.pop_front()
    }
}

pub fn classify_and_queue_digit(
    machine: &mut DigitClassify,
    queue: &mut DigitQueue,
    vk: u32,
    is_up: bool,
    foreground: bool,
    injected: bool,
) -> Option<bool> {
    let saturated = queue.is_full();
    let saved_enabled = machine.enabled;
    let saved_session = machine.session_active;
    if saturated {
        machine.set_session(false, false);
    }
    let intent = machine.push(vk, is_up, foreground, injected);
    machine.set_session(saved_enabled, saved_session);
    let intent = intent?;
    if saturated {
        queue.record_drop();
        return Some(false);
    }
    if queue.push(intent) {
        Some(intent.consumed)
    } else {
        queue.record_drop();
        Some(false)
    }
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
            tag: format!("{hwnd:016x}"),
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
    fn digit_classifier_modifier_up_repeat_global() {
        let mut c = DigitClassify::new(true, true);
        c.push(VK_LWIN, false, true, false);
        c.push(VK_CTRL, false, true, false);
        assert_eq!(c.push(VK_0 + 1, false, true, false), None);
        c.push(VK_CTRL, true, true, false);
        assert_eq!(c.push(VK_0 + 2, true, true, false), None);
        c.push(VK_SHIFT, false, true, false);
        let down = c.push(VK_0 + 3, false, true, false).expect("send down");
        assert_eq!((down.op, down.index), (DigitOp::Send, 3));
        assert!(down.consumed && down.announce);
        c.push(VK_SHIFT, true, true, false);
        let up = c.push(VK_0 + 3, true, true, false).expect("send up");
        assert_eq!((up.op, up.consumed), (DigitOp::Send, true));
        assert_eq!(up.edge, DigitEdge::Up);
        let mut c = DigitClassify::new(true, true);
        c.push(VK_LWIN, false, false, false);
        let down = c.push(VK_0 + 4, false, false, false).expect("global down");
        assert!(down.consumed);
        let repeat = c.push(VK_0 + 4, false, false, false).expect("repeat");
        assert_eq!(repeat.edge, DigitEdge::Repeat);
        assert!(repeat.consumed && repeat.announce);
        let mut c = DigitClassify::new(true, false);
        c.push(VK_LWIN, false, true, false);
        let down = c.push(VK_0 + 5, false, true, false).expect("inactive down");
        assert!(!down.consumed);
        c.set_session(true, true);
        let repeat = c.push(VK_0 + 5, false, true, false).expect("repeat");
        assert!(!repeat.consumed);
    }

    #[test]
    fn digit_queue_saturation_fails_closed() {
        let mut c = DigitClassify::new(true, true);
        let mut q = DigitQueue::new();
        c.push(VK_LWIN, false, true, false);
        for _ in 0..512 {
            let _ = q.push(DigitIntent {
                op: DigitOp::Select,
                index: 1,
                edge: DigitEdge::Down,
                foreground: true,
                consumed: true,
                announce: true,
            });
        }
        assert!(q.is_full());
        assert_eq!(
            classify_and_queue_digit(&mut c, &mut q, VK_0 + 1, false, true, false),
            Some(false)
        );
        assert!(q.dropped >= 1);
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
}
