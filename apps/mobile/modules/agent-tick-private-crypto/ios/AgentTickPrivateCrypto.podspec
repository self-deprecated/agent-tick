Pod::Spec.new do |s|
  s.name           = 'AgentTickPrivateCrypto'
  s.version        = '1.0.0'
  s.summary        = 'Agent Tick Private Request platform cryptography'
  s.description    = 'Local Expo module that uses Apple Security.framework and CryptoKit for Agent Tick Private Request keys and decryption.'
  s.author         = 'Self Deprecated'
  s.homepage       = 'https://agenttick.sh'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
