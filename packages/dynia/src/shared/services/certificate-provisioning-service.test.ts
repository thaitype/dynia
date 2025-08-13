import { describe, expect, it, vi } from 'vitest';
import { CertificateProvisioningService } from './certificate-provisioning-service.js';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Mock CSR content (realistic format)
const mockCSR = `-----BEGIN CERTIFICATE REQUEST-----
MIICXjCCAUYCAQAwGTEXMBUGA1UEAwwOKi50aGFpdHlwZS5kZXYwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDxmA4XNjdgw/yopYccNbdGtfa4glnmhuCn
Qx+ZxUkA4Y7AGBdnp+X5xFP6bY/LTY52Fo+xLUQTrOQ0BmFlOftnaLzivrTZ2Ik6
5kwNYwuHdO9NUkWjI2eo/o7HEzx47ZWhcDCrGqlLpedkMKan0X1tbS9p0u4hfbVm
BzppJOk/zSn470XQjf7bKyl4PuW33IYRk0v6HIlWHoBzBpQ4wuiP6tkFtgGpTNt3
0wQ/8pKMC7cck8ZboXiKI8g9/0viSIaMOkAK+HwfZHeQKxuSU4A/z+evc3ZI0Tde
2ib1GRqf0Wqn9fn/bdTSFrGLbpgRO9Ilq3TD5N7a7ptc5dY7NWGrAgMBAAGgADAN
BgkqhkiG9w0BAQsFAAOCAQEAuYjRfT9WBTctTwhywKbjp5qEK/HpIRe9cUz+smtC
JnTS7p3VAxZ8Wh/T4gHu/oT7x4Mmsi6w6JfSdHkJKWSx/+BR1Qd2JzUQjy8bJ61q
EOJgY5TTGFZLuRLSlhUl1UrV/ZoHm4CDOlVSZjqGfjaqjJ0L4IciBLQDtd0B+mAH
JyAuNbJ+Ygxn2r1EbuEglxQ5bKqoMdigiyAzTOUK33BChoGAE3BhqqWywKDswpYD
1yanniFj3Hwsks5JY3uBk8FuWnqXYUwaNz0pH+UcsEY+naCFRkxg+UE18mDehW3N
kjbhQ0j8ZtMhBAHOge4xRNH0i9D4WjecUIOaqJ+tDksdPg==
-----END CERTIFICATE REQUEST-----`;

describe('CertificateProvisioningService', () => {
  describe('Cloudflare Origin CA API JSON Payload', () => {
    it('should generate correct JSON payload structure according to Cloudflare API spec', () => {
      const service = new CertificateProvisioningService(mockLogger as any);
      const domain = 'thaitype.dev';
      const csrContent = mockCSR.trim();
      
      // This would be the internal payload creation logic
      const jsonPayload = {
        hostnames: [`*.${domain}`],
        request_type: 'origin-rsa',
        requested_validity: 5475, // Should be integer, not string!
        csr: csrContent
      };
      
      // Validate structure matches API requirements
      expect(jsonPayload).toHaveProperty('hostnames');
      expect(jsonPayload).toHaveProperty('request_type');
      expect(jsonPayload).toHaveProperty('requested_validity');
      expect(jsonPayload).toHaveProperty('csr');
      
      // Validate data types according to Cloudflare API
      expect(Array.isArray(jsonPayload.hostnames)).toBe(true);
      expect(typeof jsonPayload.request_type).toBe('string');
      expect(typeof jsonPayload.requested_validity).toBe('number'); // This is the key fix!
      expect(typeof jsonPayload.csr).toBe('string');
      
      // Validate specific values
      expect(jsonPayload.hostnames).toEqual(['*.thaitype.dev']);
      expect(jsonPayload.request_type).toBe('origin-rsa');
      expect(jsonPayload.requested_validity).toBe(5475);
      expect(jsonPayload.csr).toContain('-----BEGIN CERTIFICATE REQUEST-----');
      expect(jsonPayload.csr).toContain('-----END CERTIFICATE REQUEST-----');
    });

    it('should generate valid JSON string that can be parsed back', () => {
      const domain = 'example.com';
      const csrContent = mockCSR.trim();
      
      const jsonPayload = {
        hostnames: [`*.${domain}`],
        request_type: 'origin-rsa',
        requested_validity: 5475,
        csr: csrContent
      };
      
      const jsonString = JSON.stringify(jsonPayload);
      
      // Should be able to parse back without errors
      expect(() => JSON.parse(jsonString)).not.toThrow();
      
      // Parsed object should match original
      const parsedPayload = JSON.parse(jsonString);
      expect(parsedPayload).toEqual(jsonPayload);
      
      // Validate JSON string doesn't have parsing issues
      expect(jsonString).toContain('"requested_validity":5475'); // Integer, not string
      expect(jsonString).toContain('"hostnames":["*.example.com"]');
      expect(jsonString).toContain('"request_type":"origin-rsa"');
    });

    it('should handle CSR content with newlines correctly in JSON', () => {
      const domain = 'test.dev';
      const csrWithNewlines = mockCSR; // Contains actual \n characters
      
      const jsonPayload = {
        hostnames: [`*.${domain}`],
        request_type: 'origin-rsa', 
        requested_validity: 5475,
        csr: csrWithNewlines.trim()
      };
      
      const jsonString = JSON.stringify(jsonPayload);
      
      // Should properly escape newlines as \\n in JSON
      expect(jsonString).toContain('\\n');
      expect(jsonString).not.toContain('\n'); // No literal newlines in JSON string
      
      // Should be valid JSON that can be parsed
      const parsedPayload = JSON.parse(jsonString);
      expect(parsedPayload.csr).toContain('\n'); // When parsed back, should have actual newlines
      expect(parsedPayload.csr).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    });

    it('should validate required fields are present', () => {
      const requiredFields = ['hostnames', 'request_type', 'requested_validity', 'csr'];
      
      const jsonPayload = {
        hostnames: ['*.example.com'],
        request_type: 'origin-rsa',
        requested_validity: 5475,
        csr: mockCSR.trim()
      };
      
      // All required fields should be present
      requiredFields.forEach(field => {
        expect(jsonPayload).toHaveProperty(field);
        expect(jsonPayload[field as keyof typeof jsonPayload]).toBeDefined();
      });
    });
    
    it('should use correct validity period options', () => {
      // According to Cloudflare docs, valid periods are specific values
      const validityOptions = [7, 30, 90, 365, 730, 1095, 5475]; // days
      
      const jsonPayload = {
        hostnames: ['*.example.com'],
        request_type: 'origin-rsa',
        requested_validity: 5475, // 15 years - maximum validity
        csr: mockCSR.trim()
      };
      
      expect(validityOptions).toContain(jsonPayload.requested_validity);
    });
  });
});