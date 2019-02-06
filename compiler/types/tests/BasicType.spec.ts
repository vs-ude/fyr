import { expect } from 'chai'
import * as m from 'ts-mockito'

import { BasicType } from '../'

/* We can't create an array of strings to iterate over since BasicType
 * uses string literals which are erased by the TypeScript compiler.
 * Because of this we only check selected values.
 */

describe('void BasicType', () => {
    let instance: BasicType

    before(() => {
        instance = new BasicType("void")
    })

    it('isImported() returns false', () => {
        expect(instance.isImported).to.be.false
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("void")
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal("void")
    })
})

describe('byte BasicType', () => {
    let instance: BasicType

    before(() => {
        instance = new BasicType("byte")
        instance.importFromModule = "dummy"
    })

    it('isImported() returns true', () => {
        expect(instance.isImported).to.be.true
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("byte")
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal("byte")
    })
})
