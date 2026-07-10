Pod::Spec.new do |s|
  s.name           = 'VideoAnalysis'
  s.version        = '0.1.0'
  s.summary        = 'KatKut native single-pass video/audio analysis (blur/exposure/freeze/scene-cuts/audioRMS)'
  s.description    = 'On-device per-clip measurement for KatKut: blur, exposure, freeze, scene cuts, audio loudness.'
  s.license        = 'MIT'
  s.author         = 'KatKut'
  s.homepage       = 'https://katkut.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
