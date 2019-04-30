import { Location } from '../parser'
import { Scope } from '../scope'

export enum GroupKind {
    Free = 0,
    Bound = 1,
}

export class Group {
    constructor(kind: GroupKind, name?: string) {
        this.kind = kind
        if (name) {
            this.name = name
        } else {
            this.name = "$unnamed" + Group.counter++
        }
    }

    private static counter = 1
    public kind: GroupKind

    public name: string

    public preJoin(scope: Scope, loc: Location, doThrow: boolean): Group {
        return this
    }

    public static isLess(g1: Group, g2: Group) {
        if (g1.kind < g2.kind) {
            return true
        }
        if (g1.kind == g2.kind && g1.counter < g2.counter) {
            return true
        }
        return false
    }

    public isBound(scope: Scope): boolean {
        let g = scope.resolveCanonicalGroup(this)
        return g.kind == GroupKind.Bound
    }

    private counter: number = Group.groupCounter++
    private static groupCounter = 0
}

export class TupleGroup extends Group {
    constructor(kind: GroupKind, name?: string) {
        super(kind, name)
    }

    public preJoin(scope: Scope, loc: Location, doThrow: boolean): Group {
        let g: Group = null
        for (let tg of this.groups) {
            g = g ? scope.joinGroups(g, tg, loc, doThrow) : tg
        }
        return g
    }

    public groups: Array<Group> = []
}

export class Taint {
    constructor(group: Group, loc: Location) {
        this.loc = loc
        this.group = group
    }

    public loc: Location
    public group: Group
}

export type Restrictions = {
    isConst?: boolean
}

export function combineRestrictions(r1: Restrictions, r2: Restrictions): Restrictions {
    if (!r1) {
        return r2
    }
    if (!r2) {
        return r1
    }
    return {
        isConst: r1.isConst || r2.isConst
    }
}

export enum GroupCheckFlags {
    None = 0,
    AllowIsolates = 1,
    ForbidIsolates = 2,
    IsolatesMask = 3,
    NotIsolateMask = 255 - ForbidIsolates - AllowIsolates,
    NoSideEffects = 4,
    AllowUnavailableVariable = 8,
    AllowUnavailableVariableMask = 255 - AllowUnavailableVariable,
}
