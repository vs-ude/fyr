import { expect } from 'chai'
import * as m from 'ts-mockito'

import { ArrayType, BasicType } from '../'

describe('empty ArrayType', () => {
    let instance: ArrayType
    let arrayType: BasicType

    before(() => {
        arrayType = new BasicType('byte')
        instance = new ArrayType(arrayType, null)
    })

    it('getElementType()', () => {
        expect(instance.getElementType()).to.equal(arrayType)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('[...]byte')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('[...]byte')
    })
})

describe('filled ArrayType', () => {
    let instance: ArrayType
    let arrayType: BasicType

    before(() => {
        arrayType = new BasicType('byte')
        instance = new ArrayType(arrayType, 3)
    })

    it('getElementType()', () => {
        expect(instance.getElementType()).to.equal(arrayType)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('[3]byte')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('[3]byte')
    })
})

describe('named ArrayType', () => {
    let instance: ArrayType
    let arrayType: BasicType

    before(() => {
        arrayType = new BasicType('byte')
        instance = new ArrayType(arrayType, 3)
        instance.name = 'dummy'
    })

    it('getElementType()', () => {
        expect(instance.getElementType()).to.equal(arrayType)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('dummy')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('[3]byte')
    })
})
