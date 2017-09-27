import {Type, Scope} from "./typecheck"

var _currentFile: string;

export function setCurrentFile(f: string) {
    _currentFile = f;
}

export function currentFile(): string {
    return _currentFile;
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

export type NodeOp = "is" | "rune" | "export_func" | "module" | "file" | "typeCast" | "typedef" | "structField" | "structType" | "interfaceType" | "yield" | "guardedPointerType" | "unsafePointerType" | "ellipsisAssign" | "optionalAssign" | "optionalKeyValue" | "ellipsisParam" | "strType" | "genericType" | "genericInstance" | "unary..." | "unary+" | "unary-" | "unary!" | "unary^" | "unary&" | "unary*" | "optionalId" | "ellipsisId" | "str" | "=>" | "basicType" | "+" | "-" | "*" | "/" | "&" | "|" | "%" | "^" | "&^" | "in" | "var_in" | "var" | "const" | "<<" | ">>" | "if" | "else" | "for" | "func" | "as" | "||" | "&&" | "=" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "*=" | "+=" | "-=" | "/=" | "%=" | "&=" | "&^=" | "<<=" | ">>=" | "|=" | "^=" | "?" | "..." | "!" | "id" | "str" | "bool" | "object" | "array" | "keyValue" | "orType" | "andType" | "tuple" | "arrayType" | "sliceType" | "tupleType" | "pointerType" | "funcType" | "comment" | "break" | "continue" | "return" | "++" | "--" | ";;" | "null" | "float" | "int" | "." | "[" | ":" | "(" | "import" | "importWasm" | "identifierList" | "constType" | "referenceType" | "implements" | "extends";

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
    public type: Type;
    public scope: Scope;
}
