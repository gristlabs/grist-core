import sandbox

def greet(val):
  return "With love: " + val

def main():
  sandbox.register("func1", greet)
  sandbox.run()

if __name__ == "__main__":
  main()
