import {Type, Scope, ScopeExit} from "./typecheck"

var _currentFile: string;

export function setCurrentFile(f: string) {
    _currentFile = f;
}

export function currentFile(): string {
    return _currentFile;
}

export enum AstFlags {
    None = 0,
    ZeroAfterAssignment = 1,
    ReferenceObjectMember = 2
}

export type NodeConfig = {
    readonly loc: Location;
    readonly op: NodeOp;
    readonly lhs?: Node;
    readonly condition?: Node;
    readonly rhs?: Node;
    readonly value?: string;
    readonly numValue?: number;
    readonly name?: Node;
    readonly comments?: Array<Node>;
    readonly statements?: Array<Node>;
    readonly elseBranch?: Node;
    readonly parameters?: Array<Node>;
    readonly genericParameters?: Array<Node>;
    readonly groupName?: Node;
    readonly flags?: AstFlags;
    readonly nspace?: string;
}

export type LocationPoint = {
    offset: number;
    line: number;
    column: number;
}

export type Location = {
    start: LocationPoint;
    end: LocationPoint;
    file: string;
}

export type NodeOp = "let_in" | "let" | "take" | "mapType" | "asyncFuncType" | "asyncFunc" | "spawn" | "is" | "rune" | "export_func" | "module" | "file" | "typeCast" | "typedef" | "structField" | "structType" | "interfaceType" | "yield" | "uniquePointerType" | "unsafePointerType" | "ellipsisAssign" | "optionalAssign" | "optionalKeyValue" | "ellipsisParam" | "genericType" | "genericInstance" | "unary..." | "unary+" | "unary-" | "unary!" | "unary^" | "unary&" | "unary*" | "optionalId" | "ellipsisId" | "str" | "=>" | "basicType" | "+" | "-" | "*" | "/" | "&" | "|" | "%" | "^" | "&^" | "in" | "var_in" | "var" | "<<" | ">>" | "if" | "else" | "for" | "func" | "as" | "||" | "&&" | "=" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "*=" | "+=" | "-=" | "/=" | "%=" | "&=" | "&^=" | "<<=" | ">>=" | "|=" | "^=" | "?" | "..." | "!" | "id" | "str" | "bool" | "object" | "array" | "keyValue" | "orType" | "andType" | "tuple" | "arrayType" | "sliceType" | "tupleType" | "pointerType" | "funcType" | "comment" | "break" | "continue" | "return" | "++" | "--" | ";;" | "null" | "float" | "int" | "." | "[" | ":" | "(" | "import" | "importWasm" | "identifierList" | "referenceType" | "localReferenceType" | "constType" | "implements" | "extends" | "copy" | "clone" | "len" | "cap" | "sizeof" | "aligned_sizeof" | "append" | "pop" | "push" | "tryPush";

export class Node {
    constructor(config?: NodeConfig) {
        if (config) {
            if (config.op !== undefined) {
                this.op = config.op;
            }
            if (config.lhs !== undefined) {
                this.lhs = config.lhs;
            }
            if (config.rhs !== undefined) {
                this.rhs = config.rhs;
            }
            if (config.value !== undefined) {
                this.value = config.value;
            }
            if (config.numValue !== undefined) {
                this.numValue = config.numValue;
            }
            if (config.name !== undefined) {
                this.name = config.name;
            }
            if (config.loc !== undefined) {
                this.loc = config.loc;
            }
            if (config.comments !== undefined) {
                this.comments = config.comments;
            }
            if (config.condition !== undefined) {
                this.condition = config.condition;
            }
            if (config.statements !== undefined) {
                this.statements = config.statements;
            }
            if (config.elseBranch !== undefined) {
                this.elseBranch = config.elseBranch;
            }
            if (config.parameters !== undefined) {
                this.parameters = config.parameters;
            }
            if (config.genericParameters !== undefined) {
                this.genericParameters = config.genericParameters;
            }
            if (config.groupName !== undefined) {
                this.groupName = config.groupName;
            }
            if (config.flags !== undefined) {
                this.flags = config.flags;
            }
            if (config.nspace !== undefined) {
                this.nspace = config.nspace;
            }
        }
    }

    public stringify(prefix: string): string {
        let str = "";
        if (this.comments) {
            for(let c of this.comments) {
                str += prefix + "// " + c.value + "\n";
            }
        }
        str += prefix + this.op + (this.value !== undefined ? " " + this.value : "") + "\n";
        if (this.name) {
            str += prefix + "-name:" + "\n" + this.name.stringify(prefix + "  ");
        }
        if (this.genericParameters) {
            str += prefix + "-genericParameters:" + "\n";
            for(let s of this.genericParameters) {
                str += s.stringify(prefix + "  ");
            }            
        }
        if (this.parameters) {
            str += prefix + "-parameters:" + "\n";
            for(let s of this.parameters) {
                str += s.stringify(prefix + "  ");
            }
        }
        if (this.lhs) {
            str += prefix + "-lhs:" + "\n" + this.lhs.stringify(prefix + "  ");
        }
        if (this.condition) {
            str += prefix + "-condition:" + "\n" + this.condition.stringify(prefix + "  ");
        }
        if (this.rhs) {
            str += prefix + "-rhs:" + "\n" + this.rhs.stringify(prefix + "  ");
        }
        if (this.statements) {
            str += prefix + "-statements:" + "\n";
            for(let s of this.statements) {
                str += s.stringify(prefix + "  ");
            }
        }
        if (this.elseBranch) {
            str += prefix + "-elseBranch:" + "\n" + this.elseBranch.stringify(prefix + "  ");
        }

        return str;
    }

    public isUnifyableLiteral(): boolean {
        if (this.op == "int" || this.op == "float" || this.op == "str") {
            return true;
        }
        if (this.op == "array" || this.op == "object" || this.op == "tuple") {
            if (this.lhs) { // a typed literal?
                return false;
            } 
            return true;
        }
        if (this.op == "unary&" && this.rhs.isUnifyableLiteral()) {
            return true;
        }
        return false;
    }

    public clone(): Node {
        let n = new Node();
        n.op = this.op;
        n.value = this.value;
        n.numValue = this.numValue;
        n.loc = this.loc;
        n.comments = this.comments;
        n.type = this.type;
        n.nspace = this.nspace;
        n.scope = this.scope;
        n.scopeExit = this.scopeExit;
        n.lhs = this.lhs ? this.lhs.clone() : null;
        n.rhs = this.rhs ? this.rhs.clone() : null;
        n.name = this.name ? this.name.clone() : null;
        n.condition = this.condition ? this.condition.clone() : null;
        n.elseBranch = this.elseBranch ? this.elseBranch.clone() : null;
        if (this.statements) {
            n.statements = [];
            for(let s of this.statements) {
                n.statements.push(s.clone());
            }
        }
        if (this.parameters) {
            n.parameters = [];
            for(let s of this.parameters) {
                n.parameters.push(s.clone());
            }
        }
        if (this.genericParameters) {
            n.genericParameters = [];
            for(let s of this.genericParameters) {
                n.genericParameters.push(s.clone());
            }
        }
        n.groupName = this.groupName ? this.groupName.clone() : null;
        n.flags = this.flags;
        return n;
    }

    public op: NodeOp;
    public lhs: Node;
    public rhs: Node;
    public value: string;
    public numValue: number;
    public name: Node;
    public loc: Location;
    public comments: Array<Node>;
    public condition: Node;
    public statements: Array<Node>;
    public elseBranch: Node;
    public parameters: Array<Node>;
    public genericParameters: Array<Node>;
    public groupName: Node;
    public type: Type;
    public nspace: string;
    public scope: Scope;
    public scopeExit: ScopeExit;
    public flags: AstFlags;
}
