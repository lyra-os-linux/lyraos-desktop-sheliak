prefix = get_option('prefix')

if prefix.startswith('/usr')
    apparmor_file = configure_file(input: 'lyra-desktop-icons.in',
                                   output: 'lyra-desktop-icons',
                                   configuration: {'PREFIX': prefix},
                                   install: true,
                                   install_dir: '/etc/apparmor.d')
endif