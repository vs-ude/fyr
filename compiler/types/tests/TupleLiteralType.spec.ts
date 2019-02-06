import { expect } from 'chai'
import * as m from 'ts-mockito'

import { TupleLiteralType, BasicType } from '../'

describe('empty TupleLiteralType', () => {
    let instance: TupleLiteralType

    before(() => {
        instance = new TupleLiteralType([])
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("literal()")
    })

    it('toTypeCodeString() should throw an error', () => {
        expect(instance.toTypeCodeString).to.throw("Implementation error")
    })
})

describe('(string, byte) TupleLiteralType', () => {
    let instance: TupleLiteralType

    before(() => {
        instance = new TupleLiteralType([new BasicType('string'), new BasicType('byte')])
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("literal(string,byte)")
    })

    it('toTypeCodeString() should throw an error', () => {
        expect(instance.toTypeCodeString).to.throw("Implementation error")
    })
})
