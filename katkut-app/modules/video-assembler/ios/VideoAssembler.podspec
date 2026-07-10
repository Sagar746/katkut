Pod::Spec.new do |s|
  s.name           = 'VideoAssembler'
  s.version        = '0.1.0'
  s.summary        = 'KatKut native trim/concat/export, photo-clip rendering and preview proxy generation'
  s.description    = 'On-device video assembly for KatKut: EDL trim+concat export, Ken Burns photo clips, preview proxies.'
  s.license        = 'MIT'
  s.author         = 'KatKut'
  s.homepage       = 'https://katkut.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.resource_bundles = {
    'VideoAssemblerResources' => ['Resources/**/*.png']
  }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
