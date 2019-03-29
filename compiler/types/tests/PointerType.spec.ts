import { expect } from 'chai'
import * as m from 'ts-mockito'

import { PointerType, RestrictedType, BasicType, MapType } from '../'
import { ImplementationError } from '../../errors'

describe('empty PointerType', () => {
    let instance: PointerType

    before(() => {
        instance = new PointerType(null, null)
    })

    it('toString()', () => {
        expect(() => instance.toString()).to.throw(ImplementationError)
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw(ImplementationError)
    })
})

describe('Map PointerType', () => {
    let instance: PointerType
    let elementType: MapType
    let mapElementType: BasicType
    let expectString: string = 'map[bool]bool'

    before(() => {
        mapElementType = new BasicType('bool')
        elementType = new MapType(mapElementType, mapElementType)
        instance = new PointerType(elementType, null)
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
        expect(instance.toTypeCodeString()).to.equal('&' + expectString)
    })

    it('reference toTypeCodeString()', () => {
        instance.mode = 'reference'
        expect(instance.toTypeCodeString()).to.equal('~' + expectString)
    })

    it('unique toTypeCodeString()', () => {
        instance.mode = 'unique'
        expect(instance.toTypeCodeString()).to.equal('^' + expectString)
    })

    it('strong toTypeCodeString()', () => {
        instance.mode = 'strong'
        expect(instance.toTypeCodeString()).to.equal(expectString)
    })
})

describe('bool PointerType', () => {
    let instance: PointerType
    let elementType: BasicType
    let expectString: string = 'bool'

    before(() => {
        elementType = new BasicType('bool')
        instance = new PointerType(elementType, null)
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
        expect(instance.toString()).to.equal('*' + expectString)
    })

    it('local_reference toTypeCodeString()', () => {
        instance.mode = 'local_reference'
        expect(instance.toTypeCodeString()).to.equal('&' + expectString)
    })

    it('reference toTypeCodeString()', () => {
        instance.mode = 'reference'
        expect(instance.toTypeCodeString()).to.equal('~' + expectString)
    })

    it('unique toTypeCodeString()', () => {
        instance.mode = 'unique'
        expect(instance.toTypeCodeString()).to.equal('^' + expectString)
    })

    it('strong toTypeCodeString()', () => {
        instance.mode = 'strong'
        expect(instance.toTypeCodeString()).to.equal('*' + expectString)
    })
})

describe('bool RestrictedType PointerType', () => {
    let instance: PointerType
    let elementType: RestrictedType
    let restrictedElementType: BasicType

    before(() => {
        restrictedElementType = new BasicType('bool')
        elementType = new RestrictedType(restrictedElementType, {isConst: true})
        instance = new PointerType(elementType, 'reference')
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('const ~bool')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('~const bool')
    })
})
