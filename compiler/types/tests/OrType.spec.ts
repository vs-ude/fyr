import { expect } from 'chai'
import * as m from 'ts-mockito'

import { OrType, BasicType } from '../'

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

describe('string|bool OrType', () => {
    let instance: OrType
    let types: Array<BasicType>

    before(() => {
        types = [new BasicType('string'), new BasicType('bool')]
        instance = new OrType(types)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('string | bool')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('string | bool')
    })

    it('stringsOnly()', () => {
        expect(instance.stringsOnly()).to.be.false
    })

    it('isPureValue()', () => {
        expect(instance.isPureValue()).to.be.true
    })
})

