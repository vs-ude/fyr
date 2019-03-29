import { expect } from 'chai'
import * as m from 'ts-mockito'

import { SliceType } from '../'
import { ImplementationError } from '../../errors';

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
