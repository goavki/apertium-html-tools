#!/usr/bin/env python3

import argparse
import configparser
import json
import re
import sys


def get_value(conf, key, dtype):
    return {
        'string': get_string,
        'string[]': get_string_array,
        'bool': get_bool,
        'int': get_int,
        'int[]': get_int_array
    }[dtype](conf, key)

def get_string(conf, key):
    return conf.get(key)

def get_string_array(conf, key):
    string = get_string(conf, key)
    return None if string is None else re.split(r"[, ]+", string)

def get_bool(conf, key):
    return conf.getboolean(key)

def get_int(conf, key):
    return conf.getint(key)

def get_int_array(conf, key):
    array = get_string_array(conf, key)
    return [int(x) for x in array]


def check_config(conf, result):
    # Some error checking:
    for section in conf.sections():
        if section not in ['APY', 'PERSISTENCE', 'REPLACEMENTS', 'TRANSLATOR', 'UTIL']:
            raise configparser.Error("\nUnknown section [%s]" % (section,))

    # TODO: either remove or check for all sections
    apy_diff = set(k.lower() for k in conf['APY'].keys()) - set(k.lower() for k in result.keys())
    if apy_diff:
        raise configparser.Error("\nUnknown key(s) in section [APY]: %s" % (apy_diff,))

    return True

def load_dtypes():
    dtypes = {}

    with open('tools/conf-dtypes.txt', 'r') as fields:
        lines = fields.readlines()
        lines = [line.strip() for line in lines]

        section = None

        for line in lines:
            if len(line) == 0:
                continue

            parts = line.split('|')
            parts = [part.strip() for part in parts]

            if len(parts) == 1:
                section = parts[0][1:-1]
                dtypes[section] = {}
            elif len(parts) == 2:
                key, dtype = parts
                dtypes[section][key] = dtype

    return dtypes

def load_conf(filename_config, filename_custom):
    conf = configparser.ConfigParser(allow_no_value=True)
    conf.optionxform = str

    with open(filename_config, 'r') as f:
        conf.read_file(f)
    with open(filename_custom, 'r') as f:
        conf.read_file(f)

    result = {
        'REPLACEMENTS'                   : {k: v for k, v in conf['REPLACEMENTS'].items()},
        # These are filled at various places by javascript:
        'LANGNAMES': None,
        'LOCALES': None,
        'PAIRS': None,
        'GENERATORS': None,
        'ANALYZERS': None,
        'TAGGERS': None
    }

    dtypes = load_dtypes()

    for section in conf.sections():
        if section == 'REPLACEMENTS':
            continue

        for key, value in conf.items(section):
            result[key] = get_value(conf[section], key, dtypes[section][key])

    check_config(conf, result)
    return result


def print_json(result, args):
    print(json.dumps(result))

def print_js(result, args):
    print("var config = %s;" % (json.dumps(result, indent=4, sort_keys=False, ensure_ascii=False),))

def print_keyval(result, args):
    print(result[args.key])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Load config, print stuff')
    parser.add_argument('-c', '--config', default='config.conf', help='Config file name (default: config.conf)')
    parser.add_argument('-C', '--custom', default='custom.conf', help='Customization file name (default: custom.conf)')
    subparsers = parser.add_subparsers(help='Available actions:')

    parser_json = subparsers.add_parser('json', help='Print config as json')
    parser_json.set_defaults(func=print_json)

    parser_js = subparsers.add_parser('js', help='Print config as js (with "var config =" first)')
    parser_js.set_defaults(func=print_js)

    parser_get = subparsers.add_parser('get', help='Print a specific config value')
    parser_get.set_defaults(func=print_keyval)
    parser_get.add_argument('key', help='The key whose value you want to look up')

    args = parser.parse_args()

    if 'func' in args:
        result = load_conf(args.config, args.custom)
        args.func(result, args)
    else:
        # TODO: isn't there some built-in argparse way of saying we
        # require at least one subparser argument?
        parser.print_usage()
        sys.exit(2)
