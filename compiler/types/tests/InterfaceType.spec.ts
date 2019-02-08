import { expect } from 'chai'
import * as m from 'ts-mockito'

import { InterfaceType, FunctionType } from '../'

describe('empty InterfaceType', () => {
    let instance: InterfaceType

    before(() => {
        instance = new InterfaceType()
    })

    it('getAllMethods()', () => {
        expect(instance.getAllMethods()).to.deep.equal(new Map<string, FunctionType>())
    })

    it('getAllBaseTypes()', () => {
        expect(instance.getAllBaseTypes()).to.be.undefined
    })

    // TODO: expand
})
