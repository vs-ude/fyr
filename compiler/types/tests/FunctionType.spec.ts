import { expect } from 'chai'
import * as m from 'ts-mockito'

import { FunctionType, Type, BasicType } from '../'
import { Group } from '../../group';

describe('empty FunctionType', () => {
    let instance: FunctionType

    before(() => {
        instance = new FunctionType()
    })

    it('toString() works', () => {
        expect(instance.toString()).to.equal("() => undefined")
    })

    it('toTypeCodeString() throws TypeError', () => {
        expect(instance.toTypeCodeString).to.throw(TypeError)
    })

    it('hasEllipsis() returns false', () => {
        expect(instance.hasEllipsis()).to.be.false
    })

    it('lastParameter() returns undefined', () => {
        expect(instance.lastParameter()).to.be.undefined
    })

    it('requiredParamterCount() returns 0', () => {
        expect(instance.requiredParameterCount()).to.equal(0)
    })

    it('isAsync() returns false', () => {
        expect(instance.isAsync()).to.be.false
    })

    it('createGroups() returns an empty group map', () => {
        expect(instance.createGroups()).to.deep.equal(new Map<string, Group>())
    })
})

describe('FunctionType with BasicType output', () => {
    let instance: FunctionType

    before(() => {
        // mocking toString currently (?) doesn't work: https://github.com/NagRock/ts-mockito/issues/132
        // let returnType: Type = m.mock(BasicType)
        // m.when(returnType.toString()).thenReturn('void')
        instance = new FunctionType()

        // instance.returnType = m.instance(returnType)
        instance.returnType = new BasicType('void')
    })

    it('toString() works', () => {
        expect(instance.toString()).to.equal("() => void")
    })

    it('toTypeCodeString() works', () => {
        expect(instance.toTypeCodeString()).to.equal("() => void")
    })

    it('hasEllipsis() returns false', () => {
        expect(instance.hasEllipsis()).to.be.false
    })

    it('lastParameter() returns undefined', () => {
        expect(instance.lastParameter()).to.be.undefined
    })

    it('requiredParamterCount() returns 0', () => {
        expect(instance.requiredParameterCount()).to.equal(0)
    })

    it('isAsync() returns false', () => {
        expect(instance.isAsync()).to.be.false
    })

    it('createGroups() returns an empty group map', () => {
        expect(instance.createGroups()).to.nested.include({"return": Group})
    })
})
