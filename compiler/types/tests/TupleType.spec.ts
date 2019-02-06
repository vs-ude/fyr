import { expect } from 'chai'
import * as m from 'ts-mockito'

import { TupleType, BasicType } from '../'

describe('empty TupleType', () => {
    let instance: TupleType

    before(() => {
        instance = new TupleType([])
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("()")
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal("()")
    })
})

describe('(string, byte) TupleType', () => {
    let instance: TupleType

    before(() => {
        instance = new TupleType([new BasicType('string'), new BasicType('byte')])
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("(string,byte)")
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal("(string,byte)")
    })
})

describe('custom TupleType', () => {
    let instance: TupleType

    before(() => {
        instance = new TupleType([])
        instance.name = "dummy"
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("dummy")
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal("()")
    })
})
