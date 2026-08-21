# COSMIC insertion findings

Findings from one live session, not a closed model. There are no replay
vectors yet. This record does not add new-window behavior to the conformance
movement rules.

- Start `H[A,V[B,C],D]`, A/D portrait, B/C landscape.
- Focus A/open E: A splits VERTICALLY, E bottom -> `H[V[A,E],V[B,C],D]`.
- Focus C/open E: C splits HORIZONTALLY, E right -> `H[A,V[B,H[C,E]],D]`.
- Derived: focused window splits; orientation follows focused longest axis
  (portrait vertical, landscape horizontal); E bottom/right.
- Moved-in window from another workspace behaves identically to new window.
- Workspace remembers last-focused; arriving window splits remembered window.
- Moving between workspaces on an output differs from output-edge move, the
  latter R4.
