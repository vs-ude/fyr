import { expect } from 'chai'
import * as m from 'ts-mockito'

import { FunctionType, BasicType, TupleType } from '../'
import { FunctionParameter } from '../../scopes';
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
        expect(instance.createGroups()).to.be.of.length(0)
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

    it('createGroups() returns a group map containing only the return group', () => {
        let result: Map<string, Group> = instance.createGroups()
        expect(result).to.be.of.length(1)
        expect(result).to.have.all.keys('return')
    })
})

describe('named FunctionType with BasicType output', () => {
    let instance: FunctionType

    before(() => {
        // mocking toString currently (?) doesn't work: https://github.com/NagRock/ts-mockito/issues/132
        // let returnType: Type = m.mock(BasicType)
        // m.when(returnType.toString()).thenReturn('void')
        instance = new FunctionType()
        // instance.returnType = m.instance(returnType)
        instance.returnType = new BasicType('void')
        instance.name = 'dummy'
    })

    it('toString() works', () => {
        expect(instance.toString()).to.equal("dummy")
    })

    it('toTypeCodeString() works', () => {
        expect(instance.toTypeCodeString()).to.equal("dummy")
    })

    it('createGroups() returns a group map containing the return group', () => {
        let result: Map<string, Group> = instance.createGroups()
        expect(result).to.be.of.length(1)
        expect(result).to.have.all.keys('return')
    })
})

describe('named member FunctionType with BasicType output', () => {
    let instance: FunctionType

    before(() => {
        // mocking toString currently (?) doesn't work: https://github.com/NagRock/ts-mockito/issues/132
        // let returnType: Type = m.mock(BasicType)
        // m.when(returnType.toString()).thenReturn('void')
        instance = new FunctionType()
        // instance.returnType = m.instance(returnType)
        instance.returnType = new BasicType('void')
        instance.objectType = new BasicType('uint')
        instance.name = 'dummy'
    })

    it('toString() works', () => {
        expect(instance.toString()).to.equal("uint.dummy")
    })

    it('toTypeCodeString() works', () => {
        expect(instance.toTypeCodeString()).to.equal("uint.dummy")
    })

    it('createGroups() returns a group map containing the return and this groups', () => {
        let result: Map<string, Group> = instance.createGroups()
        expect(result).to.be.of.length(2)
        expect(result).to.have.all.keys('return', 'this')
    })
})

describe('FunctionType with two params, an ellipsis and BasicType output', () => {
    let instance: FunctionType
    let param1: FunctionParameter
    let param2: FunctionParameter

    before(() => {
        param1 = m.mock(FunctionParameter)
        m.when(param1.name).thenReturn('param1')
        m.when(param1.ellipsis).thenReturn(false)
        m.when(param1.type).thenReturn(new BasicType('int'))
        param1 = m.instance(param1)

        param2 = m.mock(FunctionParameter)
        m.when(param2.name).thenReturn('param2')
        m.when(param2.ellipsis).thenReturn(true)
        m.when(param2.type).thenReturn(new BasicType('float'))
        param2 = m.instance(param2)

        instance = new FunctionType()
        instance.returnType = new BasicType('void')
        instance.parameters = [param1, param2]
    })

    it('toString() works', () => {
        expect(instance.toString()).to.equal("(int,...float) => void")
    })

    it('toTypeCodeString() works', () => {
        expect(instance.toTypeCodeString()).to.equal("(int,...float) => void")
    })

    it('hasEllipsis() returns true', () => {
        expect(instance.hasEllipsis()).to.be.true
    })

    it('lastParameter() returns the correct parameter', () => {
        expect(instance.lastParameter()).to.equal(param2)
    })

    it('requiredParamterCount() returns 1, ignoring the ellipsis', () => {
        expect(instance.requiredParameterCount()).to.equal(1)
    })

    it('createGroups() returns a group map with both params and the return', () => {
        let result: Map<string, Group> = instance.createGroups()
        expect(result).to.be.of.length(3)
        expect(result).to.have.all.keys('param1', 'param2', 'return')
    })
})

describe('FunctionType with a single parameter and tuple return type', () => {
    let instance: FunctionType
    let param: FunctionParameter

    before(() => {
        param = m.mock(FunctionParameter)
        m.when(param.name).thenReturn('param')
        m.when(param.ellipsis).thenReturn(false)
        m.when(param.type).thenReturn(new BasicType('void'))
        param = m.instance(param)

        instance = new FunctionType()
        instance.returnType = new TupleType([new BasicType('string'), new BasicType('void')])
        instance.parameters = [param]
    })

    it('toString() works', () => {
        expect(instance.toString()).to.equal("(void) => (string,void)")
    })

    it('toTypeCodeString() works', () => {
        expect(instance.toTypeCodeString()).to.equal("(void) => (string,void)")
    })

    it('hasEllipsis() returns false', () => {
        expect(instance.hasEllipsis()).to.be.false
    })

    it('lastParameter() returns the parameter', () => {
        expect(instance.lastParameter()).to.equal(param)
    })

    it('requiredParamterCount() returns 1', () => {
        expect(instance.requiredParameterCount()).to.equal(1)
    })

    it('createGroups() returns a group map with both params and the return', () => {
        let result: Map<string, Group> = instance.createGroups()
        expect(result).to.be.of.length(3)
        expect(result).to.have.all.keys('param', 'return 0', 'return 1')
    })
})
