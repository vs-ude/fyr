import { Type } from '../types'
import { TypeError, Group, GroupKind, TupleGroup } from '../typecheck'
import { Location, Node } from '../parser'
import { Package } from '../pkg'
import { ImplementationError } from '../errors'

import { ScopeElement, Function } from './'

export class Scope {
    constructor(parent: Scope) {
        this.parent = parent
        this.elements = new Map<string, ScopeElement>()
        this.types = new Map<string, Type>()
    }

    public resolveElement(name: string): ScopeElement {
        let t = this.elements.get(name)
        if (!t) {
            if (this.parent) {
                return this.parent.resolveElement(name)
            }
            return null
        }
        return t
    }

    public resolveElementWithScope(name: string): [ScopeElement, Scope] {
        let t = this.elements.get(name)
        if (!t) {
            if (this.parent) {
                return this.parent.resolveElementWithScope(name)
            }
            return [null, null]
        }
        return [t, this]
    }

    public resolveType(name: string): Type {
        let t = this.types.get(name)
        if (!t) {
            if (this.parent) {
                return this.parent.resolveType(name)
            }
            return null
        }
        return t
    }

    /**
     * @param name
     * @param element
     */
    public registerType(name: string, type: Type, loc: Location = null): void {
        if (this.elements.has(name)) {
            // TODO: Output file name
            throw new TypeError("Duplicate type " + name + "." + this.elements.get(name).loc ? "Already defined in " + this.elements.get(name).loc.start.line : "", loc)
        }
        this.types.set(name, type)
    }

    public replaceType(name: string, type: Type): void {
        this.types.set(name, type)
    }

    /**
     * @param name
     * @param element
     */
    public registerElement(name: string, element: ScopeElement, loc: Location = null): void {
        if (this.elements.has(name)) {
            // TODO: Output file name
            throw new TypeError("Duplicate identifier " + name + ", already defined in " + this.elements.get(name).loc.start.line, loc ? loc : element.loc)
        }
        this.elements.set(name, element)
    }

    public resetGroups() {
        if (this.elementGroups.size > 0) {
            this.elementGroups = new Map<ScopeElement, Group | null>()
        }
        if (this.unavailableGroups.size > 0) {
            this.unavailableGroups = new Set<Group>()
        }
        if (this.canonicalGroups.size > 0) {
            this.canonicalGroups = new Map<Group, Group>()
        }
    }

    public resolveGroup(element: ScopeElement): Group | null {
        if (this.elementGroups.has(element)) {
            return this.elementGroups.get(element)
        }
        if (this.parent) {
            let p = this.parent.resolveGroup(element)
            if (p) {
                return p
            }
        }
        return null
    }

    /**
     * ScopeElements are inaccessible, unless they belong to a group.
     * A 'null' group means that the element is inaccessible and its value should not be used any further.
     * This includes that its value does not need destruction any more.
     * However, destruction is safe nevertheless. Therefore, such elements are zero'd to ensure that subsequent destruction does not crash.
     */
    public setGroup(element: ScopeElement, group: Group | null) {
        this.elementGroups.set(element, group)
        this.elementNeedsDestruction.set(element, !!group)
    }

    public makeGroupUnavailable(g: Group) {
        g = this.resolveCanonicalGroup(g)
        this.unavailableGroups.add(g)
    }

    public isGroupAvailable(g: Group): boolean {
        if (this.unavailableGroups.has(g)) {
            return false
        }
        let s: Scope = this
        while (s.parent) {
            if (s.unavailableGroups.has(g)) {
                return false
            }
            s = s.parent
        }
        let c = this.resolveCanonicalGroup(g)
        if (c != g) {
            if (this.unavailableGroups.has(c)) {
                return false
            }
            let s: Scope = this
            while (s.parent) {
                if (s.unavailableGroups.has(c)) {
                    return false
                }
                s = s.parent
            }
        }
        return true
    }

    public resolveCanonicalGroup(g: Group): Group {
        if (this.canonicalGroups.has(g)) {
            return this.canonicalGroups.get(g)
        }
        if (this.parent) {
            let p = this.parent.resolveCanonicalGroup(g)
            if (p) {
                return p
            }
        }
        return g
    }

    public joinGroups(group1: Group | null, group2: Group | null, loc: Location, doThrow: boolean): Group {
        if (!group1) {
            if (!group2) {
                return new Group(GroupKind.Free)
            }
            return group2
        }
        if (!group2) {
            return group1
        }

        let b1 = this.resolveCanonicalGroup(group1)
        let b2 = this.resolveCanonicalGroup(group2)
        // No join necessary?
        if (b1 == b2) {
            return b1
        }

        b1 = b1.preJoin(this, loc, doThrow)
        b2 = b2.preJoin(this, loc, doThrow)

        if (b1 instanceof TupleGroup || b2 instanceof TupleGroup) {
            throw new ImplementationError()
        }

        if ((b1.kind == GroupKind.Bound && b2.kind != GroupKind.Free) || (b2.kind == GroupKind.Bound && b1!.kind != GroupKind.Free)) {
            if (doThrow) {
                throw new TypeError("Groups cannot be unified", loc)
            }
            return null
        }

        if (Group.isLess(b1, b2)) {
            let tmp = b1
            b1 = b2
            b2 = tmp
        }

        if (!this.isGroupAvailable(b2)) {
            this.makeGroupUnavailable(b1)
        }
        this.canonicalGroups.set(b2, b1)
        return b1
    }

    public mergeScopes(scope: Scope, mode: "conditional" | "subsequent"): void {
        for(let g of scope.unavailableGroups) {
            this.unavailableGroups.add(g)
        }

        for(let g of scope.canonicalGroups.keys()) {
            let c1 = this.resolveCanonicalGroup(g)
            let c2 = scope.resolveCanonicalGroup(g);
            if (g == c1) {
                this.canonicalGroups.set(g, c2)
            } else if (c1 != c2) {
                let newg = this.joinGroups(c1, c2, null, false)
                if (!newg) {
                    this.unavailableGroups.add(g)
                } else {
                    this.canonicalGroups.set(g, newg)
                }
            }
        }

        switch (mode) {
            case "subsequent":
            {
                for(let e of scope.elementGroups.keys()) {
                    let g1 = this.resolveGroup(e)
                    let g2 = scope.elementGroups.get(e)
                    // Do both scopes have a group for this element? If different, use the one from the "scope" scope.
                    if (g1 && g2) {
                        g1 = this.resolveCanonicalGroup(g1)
                        g2 = scope.resolveCanonicalGroup(g2)
                        // Groups are the same in the "this" scope and the "scope" scope? Then do nothing
                        if (g1 == g2) {
                            continue
                        }
                        // The "this" scope has a group, but the "scope" scope has the "newer" group.
                        // Therefore, we use the group of the "scope" scope.
                        this.elementGroups.set(e, g2)
                    } else {
                        // The "this" scope has no group, but the "scope" scope has a group.
                        // If this is not conditional, the result is a non-null group.
                        // Otherwise we assume the worst and stick with the non-null group.
                        this.elementGroups.set(e, g2)
                    }
                }
                this.elementNeedsDestruction = new Map<ScopeElement, boolean>([...this.elementNeedsDestruction, ...scope.elementNeedsDestruction])
                break
            }
            case "conditional":
            {
                for(let e of scope.elementGroups.keys()) {
                    let g1 = this.resolveGroup(e)
                    let g2 = scope.elementGroups.get(e)
                    // Does the "this" scope have a group for this element? If yes, then both have something -> merge
                    if (g1 && g2) {
                        g1 = this.resolveCanonicalGroup(g1)
                        g2 = scope.resolveCanonicalGroup(g2)
                        // Groups are different in the "this" scope and the "scope" scope? Then do nothing
                        if (g1 == g2) {
                            continue
                        }
                        this.elementGroups.set(e, this.joinGroups(g1, g2, null, false))
                    } else {
                        // The group is null in "this". Because "scope" is only conditional, we must stay with "null"
                        // Do nothing by intention
                        this.elementGroups.set(e, null)
                    }
                }
                for(let e of scope.elementNeedsDestruction.keys()) {
                    let destruct = scope.elementNeedsDestruction.get(e)
                    if (!this.elementNeedsDestruction.has(e)) {
                        this.elementNeedsDestruction.set(e, destruct)
                    } else if (destruct) {
                        this.elementNeedsDestruction.set(e, true)
                    }
                }
                break
            }
        }
    }

    public envelopingFunction(): Function {
        if (this.func) {
            return this.func
        }
        if (this.parent) {
            return this.parent.envelopingFunction()
        }
        return null
    }

    // TODO: If in closure, stop at function boundary?
    public isInForLoop(): boolean {
        if (this.forLoop) {
            return true
        }
        if (this.parent) {
            return this.parent.isInForLoop()
        }
        return false
    }

    public isChildScope(parent: Scope): boolean {
        if (this.parent == parent) {
            return true
        }
        if (this.parent) {
            return this.parent.isChildScope(parent)
        }
        return false
    }

    public package(): Package {
        if (this.pkg) {
            return this.pkg
        }
        if (this.parent) {
            return this.parent.package()
        }
        return null
    }

    // The function to which the scope belongs
    public func: Function
    // True, if this is the scope of a for loop's body.
    public forLoop: boolean
    // The elements defined in the scope
    public elements: Map<string, ScopeElement>
    // The types defined in the scope
    public types: Map<string, Type>
    public canonicalGroups: Map<Group, Group> = new Map<Group, Group>()
    public unavailableGroups: Set<Group> = new Set<Group>()
    public elementGroups: Map<ScopeElement, Group | null> = new Map<ScopeElement, Group | null>()
    /**
     * If a Group is "null", the element is not accessible.
     * However, it might still possibly contain a value with pointers (for example set in an if clause), and this value needs destruction.
     * If the element is not in this set, it is guaranteed to need no destruction.
     */
    public elementNeedsDestruction: Map<ScopeElement, boolean> = new Map<ScopeElement, boolean>()
    public parent: Scope | null = null
    // When taking addresses of local variables, the resulting pointer belongs to this scope.
    public group: Group = new Group(GroupKind.Bound)
    // Top-level scopes carry information about the package they belong to.
    public pkg: Package

    private static counter: number = 1
}

export class ScopeExit {
    public merge(s: ScopeExit, returnsOnly: boolean = false) {
        if (!this.returns) {
            this.returns = s.returns
        } else if (s.returns) {
            this.returns = this.returns.concat(s.returns)
        }
        if (returnsOnly) {
            return
        }
        if (!this.continues) {
            this.continues = s.continues
        } else if (s.continues) {
            this.continues = this.continues.concat(s.continues)
        }
        if (!this.breaks) {
            this.breaks = s.breaks
        } else if (s.breaks) {
            this.breaks = this.breaks.concat(s.breaks)
        }
    }

    public returns: Array<Scope>
    public breaks: Array<Scope>
    public continues: Array<Scope>
    public fallthrough: Scope | null
}
