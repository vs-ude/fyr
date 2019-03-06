import { expect } from 'chai'
import * as m from 'ts-mockito'

import { MapType, BasicType } from '../'

describe('empty MapType', () => {
    let instance: MapType

    before(() => {
        instance = new MapType(null, null)
    })

    it('toString()', () => {
        expect(() => instance.toString()).to.throw(/Cannot read/)
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw(/Cannot read/)
    })
})

describe('string, bool MapType', () => {
    let instance: MapType
    let keyType: BasicType
    let valueType: BasicType

    before(() => {
        keyType = new BasicType('string')
        valueType = new BasicType('bool')
        instance = new MapType(keyType, valueType)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('map[string]bool')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('map[string]bool')
    })
})

