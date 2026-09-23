//! Session operation families: cohesive `impl Session` splits by operation.
//!
//! Each child owns one operation family; shared types, transaction
//! mechanics, world state, fit, validation/projection helpers, and tests
//! remain in the parent session module.

pub mod drag;
pub mod float;
pub mod focus;
pub mod lifecycle;
#[path = "move.rs"]
pub mod r#move;
pub mod resize;
pub mod workspace;
