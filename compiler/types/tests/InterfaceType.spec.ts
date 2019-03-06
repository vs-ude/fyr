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

    it('hasBaseType()', () => {
        expect(instance.hasBaseType(null)).to.be.false
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("interface{}")
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw("TODO")
    })

    it('method()', () => {
        expect(instance.method('none')).to.be.null
    })

    it('methodIndex()', () => {
        expect(() => instance.methodIndex('none')).to.throw(/Implementation error.*/)
    })

    it('sortMethodNames()', () => {
        expect(instance.sortMethodNames()).to.deep.equal(['__dtr__'])
    })
})

describe('filled InterfaceType', () => {
    let instance: InterfaceType
    let extendsInterface: InterfaceType
    let methodOne: FunctionType

    before(() => {
        instance = new InterfaceType()
        extendsInterface = new InterfaceType()
        methodOne = new FunctionType()

        instance.extendsInterfaces.push(extendsInterface)
        instance.methods.set('one', methodOne)
    })

    it('getAllMethods()', () => {
        let expected = new Map<string, FunctionType>()
        expected.set('one', methodOne)

        expect(instance.getAllMethods()).to.deep.equal(expected)
    })

    it('getAllBaseTypes()', () => {
        expect(instance.getAllBaseTypes()).to.be.an('Array').and.have.members([extendsInterface])
    })

    it('hasBaseType()', () => {
        expect(instance.hasBaseType(null)).to.be.false
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal("interface{...}")
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw("TODO")
    })

    it('method()', () => {
        expect(instance.method('one')).to.equal(methodOne)
    })

    it('methodIndex()', () => {
        expect(instance.methodIndex('one')).to.be.a('number').and.be.greaterThan(0)
    })

    it('sortMethodNames()', () => {
        expect(instance.sortMethodNames()).to.deep.equal(['__dtr__', 'one'])
    })
})

describe('named extension InterfaceType', () => {
    let instance: InterfaceType
    let extendsInterface: InterfaceType
    let methodOne: FunctionType

    before(() => {
        instance = new InterfaceType()
        extendsInterface = new InterfaceType()
        methodOne = new FunctionType()

        extendsInterface.methods.set('one', methodOne)
        instance.name = 'test'
        instance.extendsInterfaces.push(extendsInterface)
    })

    it('getAllMethods()', () => {
        let expected = new Map<string, FunctionType>()
        expected.set('one', methodOne)

        expect(instance.getAllMethods()).to.deep.equal(expected)
    })

    it('getAllBaseTypes()', () => {
        expect(instance.getAllBaseTypes()).to.be.an('Array').and.have.members([extendsInterface])
    })

    it('hasBaseType()', () => {
        expect(instance.hasBaseType(null)).to.be.false
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('test')
    })

    it('toTypeCodeString()', () => {
        expect(instance.toTypeCodeString()).to.equal('test')
    })

    it('method()', () => {
        expect(instance.method('one')).to.equal(methodOne)
    })

    it('methodIndex()', () => {
        expect(instance.methodIndex('one')).to.be.a('number').and.be.greaterThan(0)
    })

    it('sortMethodNames()', () => {
        expect(instance.sortMethodNames()).to.deep.equal(['__dtr__', 'one'])
    })
})
