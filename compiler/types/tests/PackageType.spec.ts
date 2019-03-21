import { expect } from 'chai'
import * as m from 'ts-mockito'

import { PackageType } from '../'
import { Package } from '../../pkg'
import { ImplementationError } from '../../errors';

describe('empty PackageType', () => {
    let instance: PackageType

    before(() => {
        instance = new PackageType(null, null, null)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('package null')
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw(ImplementationError)
    })
})

describe('filled PackageType', () => {
    let instance: PackageType

    before(() => {
        let pkg: Package = m.mock(Package)
        instance = new PackageType('test', pkg, null)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('package test')
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw(ImplementationError)
    })
})
