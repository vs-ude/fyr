import { expect } from 'chai'
import * as m from 'ts-mockito'

import { StringLiteralType } from '../'

describe('empty StringLiteralType', () => {
    let instance: StringLiteralType

    before(() => {
        instance = new StringLiteralType(null)
    })

    it('toString() & toTypeCodeString', () => {
        let expected: string = '"null"'
        expect(instance.toString()).to.equal(expected)
        expect(instance.toTypeCodeString()).to.equal(expected)
    })
})

describe('filled StringLiteralType', () => {
    let instance: StringLiteralType
    let name: string

    before(() => {
        name = 'test'
        instance = new StringLiteralType(name)
    })

    it('toString() & toTypeCodeString', () => {
        let expected: string = '"' + name + '"'
        expect(instance.toString()).to.equal(expected)
        expect(instance.toTypeCodeString()).to.equal(expected)
    })
})

