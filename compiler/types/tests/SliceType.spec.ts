import { expect } from 'chai'
import * as m from 'ts-mockito'

import { SliceType, ArrayType, RestrictedType, BasicType } from '../'
import { ImplementationError } from '../../errors'

describe('empty SliceType', () => {
    let instance: SliceType

    before(() => {
        instance = new SliceType(null, null)
    })

    it('toString()', () => {
        expect(() => instance.toString()).to.throw(Error)
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw(Error)
    })

    it('array()', () => {
        expect(() => instance.array()).to.throw(Error)
    })

    it('getElementType()', () => {
        expect(() => instance.getElementType()).to.throw(Error)
    })
})

describe('SliceType of non-Array', () => {
    it('', () => {
        let inner: BasicType = m.mock(BasicType)
        let restricted: RestrictedType = new RestrictedType(inner)
        expect(() => new SliceType(restricted, null)).to.throw(ImplementationError)
    })
})

describe('Restricted SliceType', () => {
    let instance: SliceType
    let inner: BasicType
    let array: ArrayType
    let expectString: string

    before(() => {
        inner = new BasicType('bool')
        array = new ArrayType(inner, 10)
        expectString = '[]bool'

        instance = new SliceType(new RestrictedType(array), null)
    })

    it('local_reference toString()', () => {
        instance.mode = 'local_reference'
        expect(instance.toString()).to.equal('&' + expectString)
    })

    it('reference toString()', () => {
        instance.mode = 'reference'
        expect(instance.toString()).to.equal('~' + expectString)
    })

    it('unique toString()', () => {
        instance.mode = 'unique'
        expect(instance.toString()).to.equal('^' + expectString)
    })

    it('strong toString()', () => {
        instance.mode = 'strong'
        expect(instance.toString()).to.equal(expectString)
    })

    it('local_reference toTypeCodeString()', () => {
        instance.mode = 'local_reference'
        expect(instance.toTypeCodeString()).to.equal('local_reference' + expectString)
    })

    it('reference toTypeCodeString()', () => {
        instance.mode = 'reference'
        expect(instance.toTypeCodeString()).to.equal('reference' + expectString)
    })

    it('unique toTypeCodeString()', () => {
        instance.mode = 'unique'
        expect(instance.toTypeCodeString()).to.equal('unique' + expectString)
    })

    it('strong toTypeCodeString()', () => {
        instance.mode = 'strong'
        expect(instance.toTypeCodeString()).to.equal('strong' + expectString)
    })

    it('array()', () => {
        expect(instance.array()).to.equal(array)
    })

    it('getElementType()', () => {
        expect(instance.getElementType()).to.equal(inner)
    })
})

describe('ArrayType SliceType', () => {
    let instance: SliceType
    let inner: BasicType
    let array: ArrayType

    before(() => {
        inner = new BasicType('bool')
        array = new ArrayType(inner, 10)

        instance = new SliceType(array, null)
    })

    it('array()', () => {
        expect(instance.array()).to.equal(array)
    })

    it('getElementType()', () => {
        expect(instance.getElementType()).to.equal(inner)
    })
})
