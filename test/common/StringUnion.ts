import {StringUnion} from 'app/common/StringUnion';
import {assert} from 'chai';

describe('StringUnion', function() {
  // Create Dog type
  const Dog = StringUnion(
    "bulldog",
    "poodle",
    "greyhound"
  );
  type Dog = typeof Dog.type;

  // Create Cat type
  const Cat = StringUnion(
    "siamese",
    "sphynx",
    "bengal"
  );
  type Cat = typeof Cat.type;

  it('should provide check and guard functions', function() {
    let dog: Dog;
    let cat: Cat;

    const greyhound = "greyhound";
    const bengal = "bengal";
    const giraffe = "giraffe";

    // Use Dog check function.
    dog = Dog.check(greyhound);
    assert.equal(dog, greyhound);

    assert.doesNotThrow(() => { dog = Dog.check(greyhound); });
    assert.throws(() => { dog = Dog.check(bengal); },
      `Value '"bengal"' is not assignable to type '"bulldog" | "poodle" | "greyhound"'`);
    assert.throws(() => { dog = Dog.check(giraffe); },
      `Value '"giraffe"' is not assignable to type '"bulldog" | "poodle" | "greyhound"'`);

    // Use Cat check function.
    cat = Cat.check(bengal);
    assert.equal(cat, bengal);

    assert.doesNotThrow(() => { cat = Cat.check(bengal); });
    assert.throws(() => { cat = Cat.check(greyhound); },
      `Value '"greyhound"' is not assignable to type '"siamese" | "sphynx" | "bengal"'`);
    assert.throws(() => { cat = Cat.check(giraffe); },
      `Value '"giraffe"' is not assignable to type '"siamese" | "sphynx" | "bengal"'`);

    // Use Dog guard function.
    assert.isTrue(Dog.guard(greyhound));
    assert.isFalse(Dog.guard(bengal));
    assert.isFalse(Dog.guard(giraffe));

    // Use Cat guard function.
    assert.isTrue(Cat.guard(bengal));
    assert.isFalse(Cat.guard(greyhound));
    assert.isFalse(Cat.guard(giraffe));
  });
});
