<?php

declare(strict_types=1);

const LIMITS = [
    'MAX_REGISTERS'             => 256,
    'MAX_REGISTER_WIDTH'        => 128,
    'MAX_FIELDS_PER_REGISTER'   => 64,
    'MAX_ENUM_ENTRIES'          => 256,
    'MAX_NAME_LENGTH'           => 200,
    'MAX_METADATA_STRING_LENGTH' => 500,
    'MAX_PAYLOAD_SIZE'          => 512 * 1024,
    'MAX_PROJECTS_PER_USER'     => 100,
    'VALID_ADDRESS_UNIT_BITS'   => [8, 16, 32, 64, 128],
];

const VALID_FIELD_TYPES = ['flag', 'enum', 'integer', 'float', 'fixed-point'];
const VALID_SIGNEDNESS = ['unsigned', 'twos-complement', 'sign-magnitude'];
const VALID_FLOAT_TYPES = ['half' => 16, 'single' => 32, 'double' => 64];

/**
 * Validate incoming project data from a create or update request.
 * Mirrors the frontend's hard project-data invariants where applicable.
 *
 * @return array{valid: true}|array{valid: false, error: string}
 */
function validateProjectData(mixed $data): array
{
    if (!is_array($data) || (count($data) > 0 && array_is_list($data))) {
        return ['valid' => false, 'error' => 'Request body must be a JSON object'];
    }

    // version
    if (($data['version'] ?? null) !== 1) {
        return ['valid' => false, 'error' => 'version must be 1'];
    }

    // registers
    if (!isset($data['registers']) || !is_array($data['registers']) || !isSequentialArray($data['registers'])) {
        return ['valid' => false, 'error' => 'registers must be an array'];
    }
    if (count($data['registers']) < 1) {
        return ['valid' => false, 'error' => 'registers must contain at least 1 register'];
    }
    if (count($data['registers']) > LIMITS['MAX_REGISTERS']) {
        return ['valid' => false, 'error' => 'registers must contain at most ' . LIMITS['MAX_REGISTERS'] . ' registers'];
    }

    foreach ($data['registers'] as $i => $reg) {
        $result = validateRegister($reg, $i);
        if (!$result['valid']) {
            return $result;
        }
    }

    // registerValues
    if (!isset($data['registerValues']) || !is_array($data['registerValues'])) {
        return ['valid' => false, 'error' => 'registerValues must be an object'];
    }
    foreach ($data['registerValues'] as $key => $val) {
        if (!is_string($val)) {
            return ['valid' => false, 'error' => "registerValues[\"$key\"] must be a string"];
        }
        if ($val !== '0x0' && !preg_match('/^0x[0-9a-fA-F]+$/', $val)) {
            return ['valid' => false, 'error' => "registerValues[\"$key\"] must be a hex string (e.g. \"0xFF\")"];
        }
    }

    // project metadata (optional)
    if (array_key_exists('project', $data)) {
        $result = validateProjectMetadata($data['project']);
        if (!$result['valid']) {
            return $result;
        }
    }

    // addressUnitBits (optional)
    if (array_key_exists('addressUnitBits', $data)) {
        if (!is_int($data['addressUnitBits']) || !in_array($data['addressUnitBits'], LIMITS['VALID_ADDRESS_UNIT_BITS'], true)) {
            return ['valid' => false, 'error' => 'addressUnitBits must be one of: ' . implode(', ', LIMITS['VALID_ADDRESS_UNIT_BITS'])];
        }
    }

    return ['valid' => true];
}

/**
 * Validate JSON object/list shape using the stdClass view from json_decode().
 *
 * Associative PHP arrays cannot distinguish empty JSON objects from empty
 * lists, so create/update handlers run this before value validation.
 *
 * @return array{valid: true}|array{valid: false, error: string}
 */
function validateProjectDataJsonShape(mixed $data): array
{
    if (!$data instanceof \stdClass) {
        return ['valid' => false, 'error' => 'Request body must be a JSON object'];
    }

    if (property_exists($data, 'registers')) {
        if (!is_array($data->registers)) {
            return ['valid' => false, 'error' => 'registers must be an array'];
        }
        foreach ($data->registers as $i => $reg) {
            if (!$reg instanceof \stdClass) {
                return ['valid' => false, 'error' => "registers[$i] must be an object"];
            }
            if (property_exists($reg, 'fields')) {
                if (!is_array($reg->fields)) {
                    return ['valid' => false, 'error' => "registers[$i].fields must be an array"];
                }
                foreach ($reg->fields as $j => $field) {
                    $result = validateFieldJsonShape($field, $i, $j);
                    if (!$result['valid']) {
                        return $result;
                    }
                }
            }
        }
    }

    if (property_exists($data, 'registerValues') && !$data->registerValues instanceof \stdClass) {
        return ['valid' => false, 'error' => 'registerValues must be an object'];
    }

    if (property_exists($data, 'project') && !$data->project instanceof \stdClass) {
        return ['valid' => false, 'error' => 'project metadata must be an object'];
    }

    return ['valid' => true];
}

/**
 * @return array{valid: true}|array{valid: false, error: string}
 */
function validateFieldJsonShape(mixed $field, int $regIndex, int $fieldIndex): array
{
    $prefix = "registers[$regIndex].fields[$fieldIndex]";

    if (!$field instanceof \stdClass) {
        return ['valid' => false, 'error' => "$prefix must be an object"];
    }

    if (property_exists($field, 'flagLabels') && !$field->flagLabels instanceof \stdClass) {
        return ['valid' => false, 'error' => "$prefix.flagLabels must be an object"];
    }

    if (property_exists($field, 'qFormat') && !$field->qFormat instanceof \stdClass) {
        return ['valid' => false, 'error' => "$prefix.qFormat must be an object with non-negative integer m and n"];
    }

    if (property_exists($field, 'enumEntries')) {
        if (!is_array($field->enumEntries)) {
            return ['valid' => false, 'error' => "$prefix.enumEntries must be an array for enum fields"];
        }
        foreach ($field->enumEntries as $k => $entry) {
            if (!$entry instanceof \stdClass) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k] must be an object"];
            }
        }
    }

    return ['valid' => true];
}

function validateRegister(mixed $reg, int $index): array
{
    if (!is_array($reg) || (count($reg) > 0 && isSequentialArray($reg))) {
        return ['valid' => false, 'error' => "registers[$index] must be an object"];
    }

    // name
    if (!isset($reg['name']) || !is_string($reg['name']) || !hasNonWhitespace($reg['name'])) {
        return ['valid' => false, 'error' => "registers[$index].name must be a non-empty string"];
    }
    if (strlen($reg['name']) > LIMITS['MAX_NAME_LENGTH']) {
        return ['valid' => false, 'error' => "registers[$index].name must be at most " . LIMITS['MAX_NAME_LENGTH'] . " characters"];
    }

    // width
    if (!isset($reg['width']) || !is_int($reg['width']) || $reg['width'] < 1 || $reg['width'] > LIMITS['MAX_REGISTER_WIDTH']) {
        return ['valid' => false, 'error' => "registers[$index].width must be an integer between 1 and " . LIMITS['MAX_REGISTER_WIDTH']];
    }

    // fields
    if (!isset($reg['fields']) || !is_array($reg['fields']) || !isSequentialArray($reg['fields'])) {
        return ['valid' => false, 'error' => "registers[$index].fields must be an array"];
    }
    if (count($reg['fields']) > LIMITS['MAX_FIELDS_PER_REGISTER']) {
        return ['valid' => false, 'error' => "registers[$index].fields must contain at most " . LIMITS['MAX_FIELDS_PER_REGISTER'] . " fields"];
    }

    foreach ($reg['fields'] as $j => $field) {
        $result = validateField($field, $index, $j);
        if (!$result['valid']) {
            return $result;
        }
    }

    // description (optional)
    if (array_key_exists('description', $reg)) {
        if (!is_string($reg['description'])) {
            return ['valid' => false, 'error' => "registers[$index].description must be a string"];
        }
        if (strlen($reg['description']) > LIMITS['MAX_METADATA_STRING_LENGTH']) {
            return ['valid' => false, 'error' => "registers[$index].description must be at most " . LIMITS['MAX_METADATA_STRING_LENGTH'] . " characters"];
        }
    }

    // offset (optional)
    if (array_key_exists('offset', $reg) && (!is_int($reg['offset']) || $reg['offset'] < 0)) {
        return ['valid' => false, 'error' => "registers[$index].offset must be a non-negative integer"];
    }

    // id (optional)
    if (array_key_exists('id', $reg) && !is_string($reg['id'])) {
        return ['valid' => false, 'error' => "registers[$index].id must be a string"];
    }

    return ['valid' => true];
}

function validateField(mixed $field, int $regIndex, int $fieldIndex): array
{
    $prefix = "registers[$regIndex].fields[$fieldIndex]";

    if (!is_array($field) || (count($field) > 0 && isSequentialArray($field))) {
        return ['valid' => false, 'error' => "$prefix must be an object"];
    }

    // name
    if (!isset($field['name']) || !is_string($field['name']) || !hasNonWhitespace($field['name'])) {
        return ['valid' => false, 'error' => "$prefix.name must be a non-empty string"];
    }
    if (strlen($field['name']) > LIMITS['MAX_NAME_LENGTH']) {
        return ['valid' => false, 'error' => "$prefix.name must be at most " . LIMITS['MAX_NAME_LENGTH'] . " characters"];
    }

    // type
    if (!isset($field['type']) || !is_string($field['type']) || !in_array($field['type'], VALID_FIELD_TYPES, true)) {
        return ['valid' => false, 'error' => "$prefix.type must be one of: " . implode(', ', VALID_FIELD_TYPES)];
    }

    // msb, lsb
    $maxBitIndex = LIMITS['MAX_REGISTER_WIDTH'] - 1;
    if (!isset($field['msb']) || !is_int($field['msb']) || $field['msb'] < 0 || $field['msb'] > $maxBitIndex) {
        return ['valid' => false, 'error' => "$prefix.msb must be an integer between 0 and $maxBitIndex"];
    }
    if (!isset($field['lsb']) || !is_int($field['lsb']) || $field['lsb'] < 0 || $field['lsb'] > $maxBitIndex) {
        return ['valid' => false, 'error' => "$prefix.lsb must be an integer between 0 and $maxBitIndex"];
    }
    if ($field['msb'] < $field['lsb']) {
        return ['valid' => false, 'error' => "$prefix.msb must be greater than or equal to lsb"];
    }

    $bitWidth = $field['msb'] - $field['lsb'] + 1;

    // description (optional)
    if (array_key_exists('description', $field)) {
        if (!is_string($field['description'])) {
            return ['valid' => false, 'error' => "$prefix.description must be a string"];
        }
        if (strlen($field['description']) > LIMITS['MAX_METADATA_STRING_LENGTH']) {
            return ['valid' => false, 'error' => "$prefix.description must be at most " . LIMITS['MAX_METADATA_STRING_LENGTH'] . " characters"];
        }
    }

    // id (optional)
    if (array_key_exists('id', $field) && !is_string($field['id'])) {
        return ['valid' => false, 'error' => "$prefix.id must be a string"];
    }

    if (array_key_exists('signedness', $field) && (!is_string($field['signedness']) || !in_array($field['signedness'], VALID_SIGNEDNESS, true))) {
        return ['valid' => false, 'error' => "$prefix.signedness must be one of: " . implode(', ', VALID_SIGNEDNESS)];
    }

    if ($field['type'] === 'flag') {
        if ($bitWidth !== 1) {
            return ['valid' => false, 'error' => "$prefix must be 1 bit wide for flag fields"];
        }

        if (array_key_exists('flagLabels', $field)) {
            if (!isJsonObject($field['flagLabels'])) {
                return ['valid' => false, 'error' => "$prefix.flagLabels must be an object"];
            }
            if (!array_key_exists('clear', $field['flagLabels']) || !is_string($field['flagLabels']['clear'])) {
                return ['valid' => false, 'error' => "$prefix.flagLabels.clear must be a string"];
            }
            if (!array_key_exists('set', $field['flagLabels']) || !is_string($field['flagLabels']['set'])) {
                return ['valid' => false, 'error' => "$prefix.flagLabels.set must be a string"];
            }
            if (
                strlen($field['flagLabels']['clear']) > LIMITS['MAX_NAME_LENGTH'] ||
                strlen($field['flagLabels']['set']) > LIMITS['MAX_NAME_LENGTH']
            ) {
                return ['valid' => false, 'error' => "$prefix.flagLabels labels must be at most " . LIMITS['MAX_NAME_LENGTH'] . " characters"];
            }
        }
    }

    if ($field['type'] === 'float') {
        if (!array_key_exists('floatType', $field) || !is_string($field['floatType']) || !array_key_exists($field['floatType'], VALID_FLOAT_TYPES)) {
            return ['valid' => false, 'error' => "$prefix.floatType must be one of: " . implode(', ', array_keys(VALID_FLOAT_TYPES)) . " for float fields"];
        }

        $expectedWidth = VALID_FLOAT_TYPES[$field['floatType']];
        if ($bitWidth !== $expectedWidth) {
            return ['valid' => false, 'error' => "$prefix {$field['floatType']} float requires $expectedWidth bits"];
        }
    }

    if ($field['type'] === 'fixed-point') {
        if (!array_key_exists('qFormat', $field) || !isJsonObject($field['qFormat'])) {
            return ['valid' => false, 'error' => "$prefix.qFormat must be an object with non-negative integer m and n"];
        }
        if (
            !array_key_exists('m', $field['qFormat']) ||
            !array_key_exists('n', $field['qFormat']) ||
            !is_int($field['qFormat']['m']) ||
            !is_int($field['qFormat']['n']) ||
            $field['qFormat']['m'] < 0 ||
            $field['qFormat']['n'] < 0
        ) {
            return ['valid' => false, 'error' => "$prefix.qFormat must be an object with non-negative integer m and n"];
        }

        $expectedWidth = $field['qFormat']['m'] + $field['qFormat']['n'];
        if ($bitWidth !== $expectedWidth) {
            return ['valid' => false, 'error' => "$prefix.qFormat requires $expectedWidth bits"];
        }
    }

    // Enum-specific: enumEntries
    if ($field['type'] === 'enum') {
        if (!array_key_exists('enumEntries', $field) || !is_array($field['enumEntries']) || !isSequentialArray($field['enumEntries'])) {
            return ['valid' => false, 'error' => "$prefix.enumEntries must be an array for enum fields"];
        }
        if (count($field['enumEntries']) > LIMITS['MAX_ENUM_ENTRIES']) {
            return ['valid' => false, 'error' => "$prefix.enumEntries must contain at most " . LIMITS['MAX_ENUM_ENTRIES'] . " entries"];
        }
        foreach ($field['enumEntries'] as $k => $entry) {
            if (!is_array($entry) || (count($entry) > 0 && isSequentialArray($entry))) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k] must be an object"];
            }
            if (!array_key_exists('value', $entry) || !is_int($entry['value'])) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k].value must be an integer"];
            }
            if (!array_key_exists('name', $entry) || !is_string($entry['name']) || !hasNonWhitespace($entry['name'])) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k].name must be a non-empty string"];
            }
            if (strlen($entry['name']) > LIMITS['MAX_NAME_LENGTH']) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k].name must be at most " . LIMITS['MAX_NAME_LENGTH'] . " characters"];
            }
        }
    }

    return ['valid' => true];
}

function validateProjectMetadata(mixed $meta): array
{
    if (!is_array($meta)) {
        return ['valid' => false, 'error' => 'project metadata must be an object'];
    }
    // Non-empty sequential arrays are not valid objects
    if (count($meta) > 0 && isSequentialArray($meta)) {
        return ['valid' => false, 'error' => 'project metadata must be an object'];
    }

    $stringFields = ['title', 'description', 'date', 'authorEmail', 'link'];
    foreach ($stringFields as $field) {
        if (array_key_exists($field, $meta)) {
            if (!is_string($meta[$field])) {
                return ['valid' => false, 'error' => "project.$field must be a string"];
            }
            if (strlen($meta[$field]) > LIMITS['MAX_METADATA_STRING_LENGTH']) {
                return ['valid' => false, 'error' => "project.$field must be at most " . LIMITS['MAX_METADATA_STRING_LENGTH'] . " characters"];
            }
        }
    }

    return ['valid' => true];
}

/**
 * Validate and normalize an email from a request body.
 *
 * @return string|ApiResponse Normalized email on success, or ApiResponse error on failure.
 */
function validateAndNormalizeEmail(array $body): string|ApiResponse
{
    $email = $body['email'] ?? null;
    if (!is_string($email) || $email === '') {
        return new ApiResponse(['error' => 'email is required'], 400);
    }
    $email = strtolower(trim($email));
    if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return new ApiResponse(['error' => 'Invalid email address'], 400);
    }
    return $email;
}

function isValidVisibility(mixed $value): bool
{
    return is_string($value) && in_array($value, ['private', 'unlisted'], true);
}

/**
 * Check if an array is a sequential (list-like) array.
 * Empty arrays are considered sequential (matching JSON [] behavior).
 */
function isSequentialArray(mixed $arr): bool
{
    return is_array($arr) && array_is_list($arr);
}

function isJsonObject(mixed $value): bool
{
    return is_array($value) && (count($value) === 0 || !array_is_list($value));
}

function hasNonWhitespace(string $value): bool
{
    return preg_match('/(*UCP)\S/u', $value) === 1;
}
