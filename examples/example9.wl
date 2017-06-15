func main() string {
    var name = "Fred" + fuck()
    return name
}

func fuck() string {
    return fuck() + "x" + fuck()
}

func dummy() string {
    return fuck()
}