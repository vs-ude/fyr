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

    it('toString()', () => {
        expect(instance.toString()).to.equal("void")
    })

    it('toTypeCodeString()', () => {
        expect(instance.toString()).to.equal("void")
    })
})

describe('byte BasicType', () => {
    let instance: BasicType

    before(() => {
        instance = new BasicType("byte")
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("byte")
    })

    it('toTypeCodeString()', () => {
        expect(instance.toString()).to.equal("byte")
    })
})
