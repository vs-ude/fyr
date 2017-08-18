func iface5() interface{int} {
    return 42
}

func useIt() int {
    return iface5() * 3
}