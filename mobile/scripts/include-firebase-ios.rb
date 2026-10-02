#!/usr/bin/env ruby
# Include the generated Firebase plist and APNs entitlement in the fresh Capacitor Xcode project.
require 'xcodeproj'
require 'pathname'

mobile_root = File.expand_path('..', __dir__)
project_dir = File.join(mobile_root, 'ios', 'App')
project_path = File.join(project_dir, 'App.xcodeproj')
app_dir = File.join(project_dir, 'App')
plist_path = File.join(app_dir, 'GoogleService-Info.plist')
entitlements_path = File.join(app_dir, 'App.entitlements')

abort('[firebase] GoogleService-Info.plist is missing; set FIREBASE_IOS_PLIST in GitHub Actions.') unless File.file?(plist_path)
abort('[firebase] generated iOS Xcode project is missing; run cap add ios first.') unless File.directory?(project_path)

project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |candidate| candidate.name == 'App' }
abort('[firebase] could not find the App target in App.xcodeproj.') unless target

relative_path = Pathname.new(plist_path).relative_path_from(Pathname.new(project_dir)).to_s
file_ref = project.files.find do |candidate|
  begin
    candidate.real_path.to_s == plist_path
  rescue StandardError
    false
  end
end
file_ref ||= project.main_group.new_file(relative_path)

target.resources_build_phase.add_file_reference(file_ref) unless target.resources_build_phase.files_references.include?(file_ref)

# APNs requires the entitlement in the signed app, and the Apple provisioning profile must also
# have Push Notifications enabled. This CI workflow creates Development builds/profiles.
File.write(entitlements_path, <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>aps-environment</key><string>development</string>
  </dict></plist>
PLIST

target.build_configurations.each do |configuration|
  configuration.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
end

project.save
puts '[firebase] GoogleService-Info.plist and APNs entitlement are configured in the iOS app.'
