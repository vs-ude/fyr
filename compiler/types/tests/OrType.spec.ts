import { expect } from 'chai'
import * as m from 'ts-mockito'

import { Static } from '../../typecheck';
import { OrType, BasicType, StringLiteralType } from '../'

describe('empty OrType', () => {
    let instance: OrType

    before(() => {
        instance = new OrType()
    })

    it('toString()', () => {
        expect(instance.toString()).to.be.empty
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.be.empty
    })

    it('stringsOnly()', () => {
        expect(instance.stringsOnly()).to.be.true
    })

    it('isPureValue()', () => {
        expect(instance.isPureValue()).to.be.true
    })
})

describe('int|bool OrType', () => {
    let instance: OrType
    let types: Array<BasicType>

    before(() => {
        Static.initIfRequired()
        types = [Static.t_int, Static.t_bool]
        instance = new OrType(types)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('int | bool')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('int | bool')
    })

    it('stringsOnly()', () => {
        expect(instance.stringsOnly()).to.be.false
    })

    it('isPureValue()', () => {
        expect(instance.isPureValue()).to.be.true
    })
})

describe('"test1"|"test2" OrType', () => {
    let instance: OrType
    let types: Array<BasicType>

    before(() => {
        Static.initIfRequired()
        types = [new StringLiteralType('test1'), new StringLiteralType('test2')]
        instance = new OrType(types)
    })

    it('stringsOnly()', () => {
        expect(instance.stringsOnly()).to.be.true
    })

    it('isPureValue()', () => {
        expect(instance.isPureValue()).to.be.false
    })
})
