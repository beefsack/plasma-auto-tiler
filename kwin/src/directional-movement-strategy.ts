import type { Direction } from "./logic";

export interface DirectionalMovementStrategy {
    readonly move: (direction: Direction) => void;
}

export interface DirectionalMovementCapabilities {
    readonly moveActiveWindow: (direction: Direction) => void;
}

export function createCosmicDirectionalMovementStrategy(
    capabilities: DirectionalMovementCapabilities,
): DirectionalMovementStrategy {
    return { move: capabilities.moveActiveWindow };
}
