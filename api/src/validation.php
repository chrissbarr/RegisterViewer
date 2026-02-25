<?php

declare(strict_types=1);

const LIMITS = [
    'MAX_REGISTERS'             => 256,
    'MAX_REGISTER_WIDTH'        => 1024,
    'MAX_FIELDS_PER_REGISTER'   => 64,
    'MAX_ENUM_ENTRIES'          => 256,
    'MAX_NAME_LENGTH'           => 200,
    'MAX_METADATA_STRING_LENGTH' => 500,
    'MAX_PAYLOAD_SIZE'          => 512 * 1024,
    'MAX_PROJECTS_PER_OWNER'    => 100,
    'VALID_ADDRESS_UNIT_BITS'   => [8, 16, 32, 64, 128],
];

/**
 * Validate incoming project data from a create or update request.
 * Port of worker/src/validation.ts — identical error messages.
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
    // An empty array is valid (empty object in JSON)
    if (count($data['registerValues']) > 0 && isSequentialArray($data['registerValues'])) {
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
    if (isset($data['project'])) {
        $result = validateProjectMetadata($data['project']);
        if (!$result['valid']) {
            return $result;
        }
    }

    // addressUnitBits (optional)
    if (isset($data['addressUnitBits'])) {
        if (!is_int($data['addressUnitBits']) || !in_array($data['addressUnitBits'], LIMITS['VALID_ADDRESS_UNIT_BITS'], true)) {
            return ['valid' => false, 'error' => 'addressUnitBits must be one of: ' . implode(', ', LIMITS['VALID_ADDRESS_UNIT_BITS'])];
        }
    }

    return ['valid' => true];
}

function validateRegister(mixed $reg, int $index): array
{
    if (!is_array($reg) || isSequentialArray($reg)) {
        return ['valid' => false, 'error' => "registers[$index] must be an object"];
    }

    // name
    if (!isset($reg['name']) || !is_string($reg['name']) || strlen($reg['name']) < 1) {
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
    if (isset($reg['description']) && !is_string($reg['description'])) {
        return ['valid' => false, 'error' => "registers[$index].description must be a string"];
    }

    // offset (optional)
    if (isset($reg['offset']) && (!is_int($reg['offset']) || $reg['offset'] < 0)) {
        return ['valid' => false, 'error' => "registers[$index].offset must be a non-negative integer"];
    }

    // id (optional)
    if (isset($reg['id']) && !is_string($reg['id'])) {
        return ['valid' => false, 'error' => "registers[$index].id must be a string"];
    }

    return ['valid' => true];
}

function validateField(mixed $field, int $regIndex, int $fieldIndex): array
{
    $prefix = "registers[$regIndex].fields[$fieldIndex]";

    if (!is_array($field) || isSequentialArray($field)) {
        return ['valid' => false, 'error' => "$prefix must be an object"];
    }

    // name
    if (!isset($field['name']) || !is_string($field['name']) || strlen($field['name']) < 1) {
        return ['valid' => false, 'error' => "$prefix.name must be a non-empty string"];
    }
    if (strlen($field['name']) > LIMITS['MAX_NAME_LENGTH']) {
        return ['valid' => false, 'error' => "$prefix.name must be at most " . LIMITS['MAX_NAME_LENGTH'] . " characters"];
    }

    // type
    $validTypes = ['flag', 'enum', 'integer', 'float', 'fixed-point'];
    if (!isset($field['type']) || !is_string($field['type']) || !in_array($field['type'], $validTypes, true)) {
        return ['valid' => false, 'error' => "$prefix.type must be one of: " . implode(', ', $validTypes)];
    }

    // msb, lsb
    if (!isset($field['msb']) || !is_int($field['msb']) || $field['msb'] < 0) {
        return ['valid' => false, 'error' => "$prefix.msb must be a non-negative integer"];
    }
    if (!isset($field['lsb']) || !is_int($field['lsb']) || $field['lsb'] < 0) {
        return ['valid' => false, 'error' => "$prefix.lsb must be a non-negative integer"];
    }

    // Enum-specific: enumEntries
    if ($field['type'] === 'enum') {
        if (!isset($field['enumEntries']) || !is_array($field['enumEntries']) || !isSequentialArray($field['enumEntries'])) {
            return ['valid' => false, 'error' => "$prefix.enumEntries must be an array for enum fields"];
        }
        if (count($field['enumEntries']) > LIMITS['MAX_ENUM_ENTRIES']) {
            return ['valid' => false, 'error' => "$prefix.enumEntries must contain at most " . LIMITS['MAX_ENUM_ENTRIES'] . " entries"];
        }
        foreach ($field['enumEntries'] as $k => $entry) {
            if (!is_array($entry) || isSequentialArray($entry)) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k] must be an object"];
            }
            if (!isset($entry['value']) || !is_int($entry['value'])) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k].value must be an integer"];
            }
            if (!isset($entry['name']) || !is_string($entry['name']) || strlen($entry['name']) < 1) {
                return ['valid' => false, 'error' => "$prefix.enumEntries[$k].name must be a non-empty string"];
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
        if (isset($meta[$field])) {
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
    if (!is_array($arr)) {
        return false;
    }
    if (count($arr) === 0) {
        return true;
    }
    return array_is_list($arr);
}
