import { expect } from 'chai'
import * as m from 'ts-mockito'

import { RestrictedType, BasicType } from '../'
import { ImplementationError } from '../../errors';
import { Restrictions } from '../../typecheck';

describe('empty RestrictedType', () => {
    let instance: RestrictedType

    before(() => {
        instance = new RestrictedType(null, null)
    })

    it('toString()', () => {
        expect(() => instance.toString()).to.throw(ImplementationError)
        expect(() => instance.toString(true)).to.throw(ImplementationError)
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw(ImplementationError)
    })
})

describe('string RestrictedType', () => {
    let instance: RestrictedType
    let elementType: BasicType

    before(() => {
        elementType = new BasicType('string')

        instance = new RestrictedType(elementType, null)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('string')
        expect(instance.toString(true)).to.equal('')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('string')
    })
})

describe('const bool RestrictedType', () => {
    let instance: RestrictedType
    let elementType: BasicType
    let restriction: Restrictions

    before(() => {
        elementType = new BasicType('bool')
        restriction = {isConst: true}

        instance = new RestrictedType(elementType, restriction)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('const bool')
        expect(instance.toString(true)).to.equal('const ')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('const bool')
    })
})

describe('static RestrictedType', () => {
    let restrictedType: RestrictedType
    let basicType: BasicType

    before(() => {
        basicType = new BasicType('bool')
        restrictedType = new RestrictedType(basicType, null)
    })

    it('strip(RestrictedType)', () => {
        expect(RestrictedType.strip(restrictedType)).to.equal(basicType)
    })

    it('strip(BasicType)', () => {
        expect(RestrictedType.strip(basicType)).to.equal(basicType)
    })
})
