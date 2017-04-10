import {Node} from "./ast"

export interface LocationPoint {
    offset: number;
    line: number;
    column: number;
}

export interface Location {
    start: LocationPoint;
    end: LocationPoint;
}

export function parse(code: string): Node

export class SyntaxError {
    message: string;
    location: Location;
}