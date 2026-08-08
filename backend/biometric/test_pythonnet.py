import sys
import os

bin_dir = os.path.abspath('SourceAFIS_bin')
sys.path.append(bin_dir)

import clr
clr.AddReference('SourceAFIS')
import System
from System import Reflection, Activator, Array, Byte

asm = Reflection.Assembly.Load('SourceAFIS')

FingerprintImage = asm.GetType('SourceAFIS.FingerprintImage')
FingerprintTemplate = asm.GetType('SourceAFIS.FingerprintTemplate')
FingerprintMatcher = asm.GetType('SourceAFIS.FingerprintMatcher')

width = 100
height = 100
pixels = Array[Byte]([0] * (width * height))
options = None # or omit

# Use Activator to instantiate FingerprintImage
image = Activator.CreateInstance(FingerprintImage, width, height, pixels)
print('Created image:', image)

# FingerprintTemplate template = new FingerprintTemplate(image)
template = Activator.CreateInstance(FingerprintTemplate, image)
print('Created template:', template)

# byte[] jsonBytes = template.ToByteArray()
method_to_byte_array = FingerprintTemplate.GetMethod('ToByteArray')
jsonBytes = method_to_byte_array.Invoke(template, None)
print('Template bytes length:', len(jsonBytes))
