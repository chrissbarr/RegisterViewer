<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\Attributes\DataProvider;

final class ValidationTest extends TestCase
{
    private static function validData(): array
    {
        return [
            'version' => 1,
            'registers' => [
                [
                    'name' => 'CTRL',
                    'width' => 8,
                    'fields' => [],
                ],
            ],
            'registerValues' => [],
        ];
    }

    private static function dataWithFields(array $fields, int $registerWidth = 8): array
    {
        $data = self::validData();
        $data['registers'][0]['width'] = $registerWidth;
        $data['registers'][0]['fields'] = $fields;
        return $data;
    }

    #[Test]
    public function validMinimalProjectData(): void
    {
        $result = validateProjectData(self::validData());
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function validProjectDataWithFields(): void
    {
        $data = self::validData();
        $data['registers'][0]['fields'] = [
            ['name' => 'EN', 'msb' => 0, 'lsb' => 0, 'type' => 'flag'],
            ['name' => 'MODE', 'msb' => 2, 'lsb' => 1, 'type' => 'integer'],
        ];
        $result = validateProjectData($data);
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function validProjectDataWithMetadata(): void
    {
        $data = self::validData();
        $data['project'] = [
            'title' => 'My Project',
            'description' => 'A test project',
        ];
        $result = validateProjectData($data);
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function validProjectDataWithAddressUnitBits(): void
    {
        $data = self::validData();
        $data['addressUnitBits'] = 8;
        $result = validateProjectData($data);
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function rejectsNonObject(): void
    {
        $result = validateProjectData('string');
        $this->assertFalse($result['valid']);

        $result = validateProjectData([1, 2, 3]);
        $this->assertFalse($result['valid']);
        $this->assertSame('Request body must be a JSON object', $result['error']);
    }

    #[Test]
    public function rejectsMissingVersion(): void
    {
        $data = self::validData();
        unset($data['version']);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertSame('version must be 1', $result['error']);
    }

    #[Test]
    public function rejectsWrongVersion(): void
    {
        $data = self::validData();
        $data['version'] = 2;
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertSame('version must be 1', $result['error']);
    }

    #[Test]
    public function rejectsMissingRegisters(): void
    {
        $data = self::validData();
        unset($data['registers']);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertSame('registers must be an array', $result['error']);
    }

    #[Test]
    public function rejectsEmptyRegisters(): void
    {
        $data = self::validData();
        $data['registers'] = [];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertSame('registers must contain at least 1 register', $result['error']);
    }

    #[Test]
    public function rejectsTooManyRegisters(): void
    {
        $data = self::validData();
        $data['registers'] = array_fill(0, 257, ['name' => 'R', 'width' => 8, 'fields' => []]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('at most 256', $result['error']);
    }

    #[Test]
    public function rejectsRegisterMissingName(): void
    {
        $data = self::validData();
        $data['registers'][0] = ['width' => 8, 'fields' => []];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('registers[0].name', $result['error']);
    }

    #[Test]
    public function rejectsWhitespaceOnlyRegisterName(): void
    {
        $data = self::validData();
        $data['registers'][0]['name'] = '   ';
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('registers[0].name', $result['error']);
    }

    #[Test]
    public function rejectsUnicodeWhitespaceOnlyRegisterName(): void
    {
        $data = self::validData();
        $data['registers'][0]['name'] = "\u{00A0}";
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('registers[0].name', $result['error']);
    }

    #[Test]
    public function rejectsRegisterBadWidth(): void
    {
        $data = self::validData();
        $data['registers'][0]['width'] = 0;
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('registers[0].width', $result['error']);
    }

    #[Test]
    public function acceptsMaximumRegisterWidth(): void
    {
        $data = self::validData();
        $data['registers'][0]['width'] = 128;
        $result = validateProjectData($data);
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function rejectsRegisterWidthTooLarge(): void
    {
        $data = self::validData();
        $data['registers'][0]['width'] = 129;
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('registers[0].width', $result['error']);
    }

    #[Test]
    public function rejectsInvalidFieldType(): void
    {
        $data = self::validData();
        $data['registers'][0]['fields'] = [
            ['name' => 'F', 'msb' => 0, 'lsb' => 0, 'type' => 'unknown'],
        ];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('type must be one of', $result['error']);
    }

    #[Test]
    public function rejectsFieldMissingMsb(): void
    {
        $data = self::validData();
        $data['registers'][0]['fields'] = [
            ['name' => 'F', 'lsb' => 0, 'type' => 'flag'],
        ];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('msb', $result['error']);
    }

    #[Test]
    public function rejectsWhitespaceOnlyFieldName(): void
    {
        $data = self::dataWithFields([
            ['name' => '   ', 'msb' => 0, 'lsb' => 0, 'type' => 'flag'],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('fields[0].name', $result['error']);
    }

    #[Test]
    public function rejectsUnicodeWhitespaceOnlyFieldName(): void
    {
        $data = self::dataWithFields([
            ['name' => "\u{00A0}", 'msb' => 0, 'lsb' => 0, 'type' => 'flag'],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('fields[0].name', $result['error']);
    }

    #[Test]
    public function rejectsFieldMsbBelowLsb(): void
    {
        $data = self::dataWithFields([
            ['name' => 'BAD', 'msb' => 0, 'lsb' => 1, 'type' => 'integer'],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('must be greater than or equal to lsb', $result['error']);
    }

    #[Test]
    public function rejectsFieldBitIndexBeyondSupportedRange(): void
    {
        $data = self::dataWithFields([
            ['name' => 'TOO_WIDE', 'msb' => 128, 'lsb' => 0, 'type' => 'integer'],
        ], 128);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('between 0 and 127', $result['error']);
    }

    #[Test]
    public function rejectsMultiBitFlag(): void
    {
        $data = self::dataWithFields([
            ['name' => 'BAD_FLAG', 'msb' => 1, 'lsb' => 0, 'type' => 'flag'],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('1 bit wide', $result['error']);
    }

    #[Test]
    public function validatesFlagLabelsWhenPresent(): void
    {
        $data = self::dataWithFields([
            [
                'name' => 'LOCKED',
                'msb' => 0,
                'lsb' => 0,
                'type' => 'flag',
                'flagLabels' => ['clear' => 'Unlocked', 'set' => 'Locked'],
            ],
        ]);
        $this->assertTrue(validateProjectData($data)['valid']);

        $data['registers'][0]['fields'][0]['flagLabels'] = ['clear' => 'Unlocked'];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('flagLabels.set', $result['error']);
    }

    #[Test]
    public function rejectsInvalidIntegerSignedness(): void
    {
        $data = self::dataWithFields([
            ['name' => 'SIGNED', 'msb' => 3, 'lsb' => 0, 'type' => 'integer', 'signedness' => 'signed'],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('signedness must be one of', $result['error']);
    }

    #[Test]
    public function rejectsFloatWithoutValidType(): void
    {
        $data = self::dataWithFields([
            ['name' => 'GAIN', 'msb' => 31, 'lsb' => 0, 'type' => 'float'],
        ], 32);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('floatType must be one of', $result['error']);
    }

    #[Test]
    public function rejectsFloatWidthMismatch(): void
    {
        $data = self::dataWithFields([
            ['name' => 'GAIN', 'msb' => 15, 'lsb' => 0, 'type' => 'float', 'floatType' => 'single'],
        ], 16);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('single float requires 32 bits', $result['error']);
    }

    #[Test]
    public function rejectsFixedPointWithoutValidQFormat(): void
    {
        $data = self::dataWithFields([
            ['name' => 'GAIN', 'msb' => 7, 'lsb' => 0, 'type' => 'fixed-point'],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('qFormat must be an object', $result['error']);
    }

    #[Test]
    public function rejectsFixedPointWidthMismatch(): void
    {
        $data = self::dataWithFields([
            [
                'name' => 'GAIN',
                'msb' => 7,
                'lsb' => 0,
                'type' => 'fixed-point',
                'qFormat' => ['m' => 4, 'n' => 2],
            ],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('qFormat requires 6 bits', $result['error']);
    }

    #[Test]
    public function acceptsWarningOnlyFieldRangeOutsideRegisterWidth(): void
    {
        $data = self::dataWithFields([
            ['name' => 'RAW16', 'msb' => 15, 'lsb' => 0, 'type' => 'integer'],
        ]);
        $this->assertTrue(validateProjectData($data)['valid']);
    }

    #[Test]
    public function acceptsWarningOnlyOverlappingFields(): void
    {
        $data = self::dataWithFields([
            ['name' => 'RAW', 'msb' => 7, 'lsb' => 0, 'type' => 'integer'],
            ['name' => 'EN', 'msb' => 0, 'lsb' => 0, 'type' => 'flag'],
        ]);
        $this->assertTrue(validateProjectData($data)['valid']);
    }

    #[Test]
    public function acceptsWarningOnlyOverlappingRegisterOffsets(): void
    {
        $data = self::validData();
        $data['registers'] = [
            ['name' => 'CTRL', 'width' => 16, 'offset' => 0, 'fields' => []],
            ['name' => 'STATUS', 'width' => 16, 'offset' => 0, 'fields' => []],
        ];

        $this->assertTrue(validateProjectData($data)['valid']);
    }

    #[Test]
    public function rejectsEnumWithoutEntries(): void
    {
        $data = self::validData();
        $data['registers'][0]['fields'] = [
            ['name' => 'F', 'msb' => 1, 'lsb' => 0, 'type' => 'enum'],
        ];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('enumEntries must be an array', $result['error']);
    }

    #[Test]
    public function acceptsEmptyEnumEntries(): void
    {
        $data = self::dataWithFields([
            ['name' => 'MODE', 'msb' => 1, 'lsb' => 0, 'type' => 'enum', 'enumEntries' => []],
        ]);
        $result = validateProjectData($data);
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function acceptsValidEnumField(): void
    {
        $data = self::validData();
        $data['registers'][0]['fields'] = [
            [
                'name' => 'MODE',
                'msb' => 1,
                'lsb' => 0,
                'type' => 'enum',
                'enumEntries' => [
                    ['value' => 0, 'name' => 'Off'],
                    ['value' => 1, 'name' => 'On'],
                ],
            ],
        ];
        $result = validateProjectData($data);
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function rejectsNonStringRegisterValue(): void
    {
        $data = self::validData();
        $data['registerValues'] = ['reg1' => 42];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('must be a string', $result['error']);
    }

    #[Test]
    public function rejectsBadHexRegisterValue(): void
    {
        $data = self::validData();
        $data['registerValues'] = ['reg1' => 'not-hex'];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('hex string', $result['error']);
    }

    #[Test]
    public function acceptsValidHexRegisterValues(): void
    {
        $data = self::validData();
        $data['registerValues'] = ['reg1' => '0xFF', 'reg2' => '0x0'];
        $result = validateProjectData($data);
        $this->assertTrue($result['valid']);
    }

    #[Test]
    public function rejectsMetadataTitleTooLong(): void
    {
        $data = self::validData();
        $data['project'] = ['title' => str_repeat('a', 501)];
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('project.title', $result['error']);
    }

    #[Test]
    public function rejectsNullProjectMetadata(): void
    {
        $data = self::validData();
        $data['project'] = null;
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertSame('project metadata must be an object', $result['error']);
    }

    #[Test]
    public function rejectsNullOptionalFieldMetadata(): void
    {
        $data = self::dataWithFields([
            ['name' => 'F', 'msb' => 0, 'lsb' => 0, 'type' => 'flag', 'description' => null],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('description must be a string', $result['error']);
    }

    #[Test]
    public function rejectsNullFlagLabels(): void
    {
        $data = self::dataWithFields([
            ['name' => 'F', 'msb' => 0, 'lsb' => 0, 'type' => 'flag', 'flagLabels' => null],
        ]);
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('flagLabels must be an object', $result['error']);
    }

    #[Test]
    public function rejectsInvalidAddressUnitBits(): void
    {
        $data = self::validData();
        $data['addressUnitBits'] = 7;
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('addressUnitBits', $result['error']);
    }

    #[Test]
    public function isValidVisibilityAcceptsValid(): void
    {
        $this->assertTrue(isValidVisibility('private'));
        $this->assertTrue(isValidVisibility('unlisted'));
    }

    #[Test]
    public function isValidVisibilityRejectsInvalid(): void
    {
        $this->assertFalse(isValidVisibility('public'));
        $this->assertFalse(isValidVisibility(''));
        $this->assertFalse(isValidVisibility(null));
        $this->assertFalse(isValidVisibility(42));
    }

    #[Test]
    public function isSequentialArrayBehavior(): void
    {
        $this->assertTrue(isSequentialArray([]));
        $this->assertTrue(isSequentialArray([1, 2, 3]));
        $this->assertFalse(isSequentialArray(['a' => 1]));
        $this->assertFalse(isSequentialArray('string'));
        $this->assertFalse(isSequentialArray(null));
    }

    #[Test]
    public function allFiveFieldTypesAccepted(): void
    {
        $fieldsByType = [
            'flag' => ['name' => 'F', 'msb' => 0, 'lsb' => 0, 'type' => 'flag'],
            'enum' => [
                'name' => 'F',
                'msb' => 1,
                'lsb' => 0,
                'type' => 'enum',
                'enumEntries' => [['value' => 0, 'name' => 'A']],
            ],
            'integer' => ['name' => 'F', 'msb' => 2, 'lsb' => 0, 'type' => 'integer', 'signedness' => 'unsigned'],
            'float' => ['name' => 'F', 'msb' => 15, 'lsb' => 0, 'type' => 'float', 'floatType' => 'half'],
            'fixed-point' => [
                'name' => 'F',
                'msb' => 7,
                'lsb' => 0,
                'type' => 'fixed-point',
                'qFormat' => ['m' => 4, 'n' => 4],
            ],
        ];

        foreach ($fieldsByType as $type => $field) {
            $data = self::validData();
            $data['registers'][0]['fields'] = [$field];
            $result = validateProjectData($data);
            $this->assertTrue($result['valid'], "Field type '$type' should be valid");
        }
    }
}
