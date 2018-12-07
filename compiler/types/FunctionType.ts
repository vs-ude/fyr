import { SystemCalls } from "../pkg"
import { TypeChecker, TypeError } from "../typecheck"
import { Group, GroupKind } from '../group'
import { FunctionParameter } from '../scopes'
import { isUnique } from '../typecheck/helper'

import { Type } from './Type'
import { TupleType } from './TupleType'

// CallingConvention is part of a FunctionType.
// It defines how the function is to be called.
export type CallingConvention = "fyr" | "fyrCoroutine" | "system" | "native"

export class FunctionType extends Type {
    constructor() {
        super()
        this.parameters = []
    }

    public toString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toString() + "." + this.name
            }
            return this.name
        }
        let name = "("
        for(let p of this.parameters) {
            if (name != "(") {
                name += ","
            }
            if (p.ellipsis) {
                name += "..."
            }
            name += p.type.toString()
        }
        name += ") => " + this.returnType.toString()
        return name
    }

    public toTypeCodeString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toTypeCodeString() + "." + this.name
            }
            return this.name
        }
        let name = "("
        for(let p of this.parameters) {
            if (name != "(") {
                name += ","
            }
            if (p.ellipsis) {
                name += "..."
            }
            name += p.type.toTypeCodeString()
        }
        name += ") => " + this.returnType.toTypeCodeString()
        return name
    }

    public hasEllipsis(): boolean {
        return (this.parameters.length > 0 && this.parameters[this.parameters.length - 1].ellipsis)
    }

    public lastParameter(): FunctionParameter {
        return this.parameters[this.parameters.length - 1]
    }

    public requiredParameterCount(): number {
        let i = 0
        for(let t of this.parameters) {
            if (!t.ellipsis) {
                i++
            }
        }
        return i
    }

    public isAsync(): boolean {
        return this.callingConvention == "fyrCoroutine"
    }

    public createGroups(): Map<string, Group> {
        let defaultGroup = new Group(GroupKind.Bound)
        let groups = new Map<string, Group>()
        let groupNames = new Map<string, Group>()
        for (let p of this.parameters) {
            if (p.type.groupName) {
                if (isUnique(p.type)) {
                    throw new TypeError("Unique pointers must not be marked with a group name", p.loc)
                }
                let g = groupNames.get(p.type.groupName)
                if (!g) {
                    g = new Group(GroupKind.Bound)
                    groupNames.set(p.type.groupName, g)
                }
                groups.set(p.name, g)
            } else {
                if (isUnique(p.type)) {
                    groups.set(p.name, new Group(GroupKind.Free))
                } else {
                    groups.set(p.name, defaultGroup)
                }
            }
        }

        if (this.returnType) {
            if (this.returnType instanceof TupleType) {
                for(let i = 0; i <this.returnType.types.length; i++) {
                    let t = this.returnType.types[i]
                    if (t.groupName) {
                        if (isUnique(t)) {
                            throw new TypeError("Unique pointers must not be marked with a group name", t.loc)
                        }
                        let g = groupNames.get(t.groupName)
                        if (!g) {
                            g = new Group(GroupKind.Bound)
                            groupNames.set(t.groupName, g)
                        }
                        groups.set("return " + i.toString(), g)
                    } else {
                        if (isUnique(t)) {
                            groups.set("return " + i.toString(), new Group(GroupKind.Free))
                        } else {
                            groups.set("return " + i.toString(), defaultGroup)
                        }
                    }
                }
            } else {
                if (this.returnType.groupName) {
                    if (isUnique(this.returnType)) {
                        throw new TypeError("Unique pointers must not be marked with a group name", this.returnType.loc)
                    }
                    let g = groupNames.get(this.returnType.groupName)
                    if (!g) {
                        g = new Group(GroupKind.Bound)
                        groupNames.set(this.returnType.groupName, g)
                    }
                    groups.set("return", g)
                } else {
                    if (isUnique(this.returnType)) {
                        groups.set("return", new Group(GroupKind.Free))
                    } else {
                        groups.set("return", defaultGroup)
                    }
                }
            }
        }

        if (this.objectType) {
            groups.set("this", defaultGroup)
        }

        return groups
    }

    public returnType: Type
    public parameters: Array<FunctionParameter>
    public callingConvention: CallingConvention = "fyr"
    public objectType: Type
    // Only used when the callingConvention is "system"
    public systemCallType: SystemCalls
// Enable this line to measure coroutines
//    public callingConvention: CallingConvention = "fyrCoroutine"
}
