func main() string {
    var name = "Fred " + action()
    return name
}

func action() string {
    return "sucks"
}

func fuck() string {
    return action() + "x" + action()
}

func dummy() string {
    return action() + action() + action()
}