import { Location } from '../parser'

export class ImplementationError extends Error {
    constructor(message?: string, loc?: Location) {
        super(message);
        // see: typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html
        Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
        this.name = ImplementationError.name; // stack traces display correctly now
        this.location = loc;
    }

    public message: string;
    public location: Location;
}

export class TodoError extends Error {
    constructor(message?: string) {
        super(message);
        // see: typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html
        Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
        this.name = TodoError.name; // stack traces display correctly now
    }
}

export class SyntaxError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
}

export class TypeError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
    public name: string = "TypeError";
}

export class ImportError {
    constructor(message: string, loc: Location, path: string) {
        this.message = message;
        this.location = loc;
        this.path = path;
    }

    public message: string;
    public location: Location;
    public path: string;
}
