function doit(ptr) {
    return ptr.a + ptr.b
}

var p = {a:1, b:2}
var r = 0
for(var i = 0; i < 320000000; i++) {
    r += doit(p)
}
