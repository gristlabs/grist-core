import unittest
import logger


class TestLogger(unittest.TestCase):
  def _log_handler(self, level, name, msg):
    self.messages.append((level, name, msg))

  def setUp(self):
    self.messages = []
    self.orig_handler = logger.set_handler(self._log_handler)

  def tearDown(self):
    logger.set_handler(self.orig_handler)

  def test_logger(self):
    log = logger.Logger("foo", logger.INFO)
    log.info("Hello Info")
    log.debug("Hello Debug")
    log.warn("Hello Warn")

    self.assertEqual(self.messages, [
      (logger.INFO, 'foo', 'Hello Info'),
      (logger.WARN, 'foo', 'Hello Warn'),
    ])
    del self.messages[:]

    log = logger.Logger("baz", logger.DEBUG)
    log.debug("Hello Debug")
    log.info("Hello Info")
    self.assertEqual(self.messages, [
      (logger.DEBUG, 'baz', 'Hello Debug'),
      (logger.INFO, 'baz', 'Hello Info'),
    ])


if __name__ == "__main__":
  unittest.main()
