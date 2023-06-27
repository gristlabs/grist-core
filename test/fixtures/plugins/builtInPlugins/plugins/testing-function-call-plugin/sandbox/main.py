import sandbox

def greet(name):
  return "Hi " + name

def yo(name):
  return "yo " + name + " from safePython"

def main():
  sandbox.register("greet", greet)
  sandbox.register("yo", yo)
  sandbox.run()

if __name__ == "__main__":
  main()
