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
    public function rejectsRegisterBadWidth(): void
    {
        $data = self::validData();
        $data['registers'][0]['width'] = 0;
        $result = validateProjectData($data);
        $this->assertFalse($result['valid']);
        $this->assertStringContainsString('registers[0].width', $result['error']);
    }

    #[Test]
    public function rejectsRegisterWidthTooLarge(): void
    {
        $data = self::validData();
        $data['registers'][0]['width'] = 1025;
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
        foreach (['flag', 'enum', 'integer', 'float', 'fixed-point'] as $type) {
            $data = self::validData();
            $field = ['name' => 'F', 'msb' => 0, 'lsb' => 0, 'type' => $type];
            if ($type === 'enum') {
                $field['enumEntries'] = [['value' => 0, 'name' => 'A']];
            }
            $data['registers'][0]['fields'] = [$field];
            $result = validateProjectData($data);
            $this->assertTrue($result['valid'], "Field type '$type' should be valid");
        }
    }
}
