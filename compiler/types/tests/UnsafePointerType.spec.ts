import { expect } from 'chai'
import * as m from 'ts-mockito'

import { UnsafePointerType, BasicType } from '../'

describe('dummy UnsafePointerType', () => {
    let instance: UnsafePointerType

    before(() => {
        instance = new UnsafePointerType(null)
        instance.name = 'dummy'
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('dummy')
    })

    it('toTypeCodeString() throws', () => {
        expect(instance.toTypeCodeString).to.throw
    })
})

describe('byte UnsafePointerType', () => {
    let instance: UnsafePointerType
    let pointerType: BasicType

    before(() => {
        pointerType = new BasicType('byte')
        instance = new UnsafePointerType(pointerType)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('#byte')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('#byte')
    })
})
