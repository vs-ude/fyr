import { expect } from 'chai'
import * as m from 'ts-mockito'

import { StructType, StructField, BasicType, FunctionType } from '../'
import { ImplementationError } from '../../errors'

describe('empty StructType', () => {
    let instance: StructType

    before(() => {
        instance = new StructType()
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('struct{}')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('struct{}')
    })

    it('field()', () => {
        expect(instance.field('')).to.be.null
    })

    it('method()', () => {
        expect(instance.method('')).to.be.null
    })

    it('getAllMethodsAndFields()', () => {
        expect(instance.getAllMethodsAndFields()).to.be.empty
    })

    it('getAllBaseTypes()', () => {
        expect(instance.getAllBaseTypes()).to.be.undefined
    })

    it('doesExtend()', () => {
        expect(instance.doesExtend(new BasicType('bool'))).to.be.false
    })
})

describe('filled StructType', () => {
    let instance: StructType
    let extending: BasicType
    let fields: Array<StructField>
    let methods: Map<string, FunctionType>

    before(() => {
        extending = new BasicType('bool')
        let field1 = new StructField()
        field1.name = 'one'
        field1.type = new BasicType('bool')
        let field2 = new StructField()
        field2.name = 'two'
        field2.type = new BasicType('bool')
        fields = [field1, field2]

        methods = new Map()
        methods.set('mOne', m.mock(FunctionType))
        methods.set('mTwo', m.mock(FunctionType))

        instance = new StructType()
        instance.extends = extending
        instance.fields = fields
        instance.methods = methods
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('struct{one bool,two bool}')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('struct{one,two}')
    })

    it('field()', () => {
        expect(instance.field('one')).to.equal(fields[0])
    })

    it('method()', () => {
        expect(instance.method('mTwo')).to.equal(methods.get('mTwo'))
    })

    it('getAllMethodsAndFields()', () => {
        let expectedLength = fields.length + methods.size
        let expectedKeys = ['one', 'two']
        methods.forEach((value, key) => {
            expectedKeys.push(key)
        })

        let result: Map<string, StructField | FunctionType> = instance.getAllMethodsAndFields()

        expect(result).to.be.of.length(expectedLength)
        expect(result).to.have.keys(expectedKeys)
    })

    it('getAllBaseTypes()', () => {
        expect(instance.getAllBaseTypes()).to.contain(extending)
    })

    it('doesExtend() with another type', () => {
        expect(instance.doesExtend(new BasicType('bool'))).to.be.false
    })

    it('doesExtend() with extending type', () => {
        expect(instance.doesExtend(extending)).to.be.true
    })

})

describe('StructField', () => {
    let instance: StructField
    let type: BasicType

    before(() => {
        type = new BasicType('bool')

        instance = new StructField()
        instance.type = type
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal(type.toString())
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal(type.toTypeCodeString())
    })
})
