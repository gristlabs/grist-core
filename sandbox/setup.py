# see bundle_as_wheel.sh

from distutils.core import setup
import glob

files = glob.glob('grist/*.py') + glob.glob('grist/**/*.py')
names = [f.split('.py')[0] for f in files]

setup(name='grist',
      version='1.0',
      include_package_data=True,
      packages=['grist', 'grist/functions', 'grist/imports'],
      package_data={
          'grist': ['grist/tzdata.data'],
      })
